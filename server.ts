import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mammoth from 'mammoth';
import {
  COMMON_GERMAN_DICTIONARY,
  analyzeGermanSentenceLocally,
  analyzeGermanWordLocally,
} from './src/data/germanDictionary';
import {
  normalizeGermanText,
  splitGermanSentences,
} from './src/utils/audioHash';
import {
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_FEMALE_VOICE_ID,
  DEFAULT_MALE_VOICE_ID,
  VERIFIED_ELEVENLABS_VOICES,
} from './src/services/elevenLabsVoices';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

// Security headers (preserve iframe embed compatibility for preview)
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Support JSON payloads up to 25MB (for TXT/PDF/DOCX document uploads)
app.use(express.json({ limit: '25mb' }));

// Simple sliding-window in-memory rate limiter
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function createRateLimiter(bucketName: string, maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${bucketName}:${ip}`;
    const now = Date.now();
    const existing = rateBuckets.get(key);
    if (!existing || now > existing.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (existing.count >= maxRequests) {
      return res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        error: 'تم تجاوز الحد المؤقت للطلبات. يرجى المحاولة بعد قليل.',
      });
    }
    existing.count += 1;
    return next();
  };
}

const ttsReadLimiter = createRateLimiter('tts-read', 180, 60_000);
const ttsWriteLimiter = createRateLimiter('tts-write', 60, 60_000);

function getElevenLabsApiKey(): string | null {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key || key === 'MY_ELEVENLABS_API_KEY') return null;
  return key;
}

function isValidMp3Buffer(buf: Buffer): boolean {
  if (!buf || buf.length < 128) return false;
  // ID3v2 header
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;
  // MPEG frame sync (11 bits set: 0xFF followed by 0xE0..0xFF)
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true;
  return false;
}

async function synthesizeWithElevenLabsServer(params: {
  text: string;
  voiceId: string;
  model: string;
  outputFormat?: string;
}): Promise<{ buffer: Buffer; contentType: string }> {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    const err: any = new Error(
      'مفتاح ELEVENLABS_API_KEY غير مضبوط على الخادم. يرجى إضافته في إعدادات الأسرار (Secrets) لتفعيل الصوت.'
    );
    err.code = 'ELEVENLABS_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }

  const rawVoiceId = typeof params.voiceId === 'string' ? params.voiceId.trim() : '';
  const resolvedVoiceId = /^[A-Za-z0-9]{10,40}$/.test(rawVoiceId)
    ? rawVoiceId
    : DEFAULT_FEMALE_VOICE_ID;
  const resolvedModel = params.model || DEFAULT_ELEVENLABS_MODEL;
  const outputFormat = params.outputFormat || 'mp3_44100_128';
  const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
    resolvedVoiceId
  )}?output_format=${encodeURIComponent(outputFormat)}`;

  const elRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: params.text,
      model_id: resolvedModel,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        use_speaker_boost: true,
      },
    }),
  });

  if (!elRes.ok) {
    let detail = `ElevenLabs API error (HTTP ${elRes.status})`;
    try {
      const errJson: any = await elRes.json();
      const rawDetail =
        errJson?.detail?.message ||
        (typeof errJson?.detail === 'string' ? errJson.detail : '') ||
        errJson?.message;
      if (rawDetail) detail = String(rawDetail);
    } catch {
      // ignore JSON parse failure
    }
    const err: any = new Error(
      elRes.status === 401 || elRes.status === 403
        ? `فشل التحقق من مفتاح ElevenLabs على الخادم: ${detail}`
        : `تعذر توليد الصوت عبر ElevenLabs: ${detail}`
    );
    err.status = elRes.status === 401 || elRes.status === 403 ? 502 : elRes.status;
    err.code =
      elRes.status === 401 || elRes.status === 403
        ? 'ELEVENLABS_AUTH_ERROR'
        : elRes.status === 429
        ? 'ELEVENLABS_QUOTA_OR_RATE_LIMIT'
        : 'ELEVENLABS_API_ERROR';
    throw err;
  }

  const arrayBuf = await elRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  if (!isValidMp3Buffer(buffer)) {
    const err: any = new Error('أعاد ElevenLabs ملفاً صوتياً فارغاً أو غير صالح.');
    err.status = 502;
    err.code = 'INVALID_MP3_RESPONSE';
    throw err;
  }

  return {
    buffer,
    contentType: elRes.headers.get('content-type') || 'audio/mpeg',
  };
}

// In-memory dictionary cache
const wordCache = new Map<string, any>();
const sentenceCache = new Map<string, any>();

// -------------------------------------------------------------
// API: Word Dictionary & Local Grammatical Analysis
// -------------------------------------------------------------
app.post('/api/dictionary/explain-word', (req: Request, res: Response) => {
  const { word, sentence = '' } = req.body || {};
  if (!word || typeof word !== 'string' || !word.trim()) {
    return res.status(400).json({ success: false, error: 'Word is required' });
  }

  const cleanWord = word.trim().replace(/[.,!?;:„"“»«()]/g, '');
  const lower = cleanWord.toLowerCase();
  const cacheKey = `${lower}|${String(sentence).slice(0, 50)}`;

  if (COMMON_GERMAN_DICTIONARY[lower]) {
    return res.json({ success: true, data: COMMON_GERMAN_DICTIONARY[lower] });
  }

  if (wordCache.has(cacheKey)) {
    return res.json({ success: true, data: wordCache.get(cacheKey) });
  }

  const data = analyzeGermanWordLocally(cleanWord, String(sentence));
  wordCache.set(cacheKey, data);
  return res.json({ success: true, data });
});

// -------------------------------------------------------------
// API: Sentence Translation & Grammar Breakdown (Local Analyzer)
// -------------------------------------------------------------
app.post('/api/dictionary/explain-sentence', (req: Request, res: Response) => {
  const { sentence } = req.body || {};
  if (!sentence || typeof sentence !== 'string' || !sentence.trim()) {
    return res.status(400).json({ success: false, error: 'Sentence is required' });
  }

  const cacheKey = sentence.trim();
  if (sentenceCache.has(cacheKey)) {
    return res.json({ success: true, data: sentenceCache.get(cacheKey) });
  }

  const data = analyzeGermanSentenceLocally(cacheKey);
  sentenceCache.set(cacheKey, data);
  return res.json({ success: true, data });
});

// -------------------------------------------------------------
// API: Parse Uploaded Documents (TXT, PDF, DOCX)
// -------------------------------------------------------------
app.post('/api/parse-document', async (req: Request, res: Response) => {
  try {
    const { fileName, fileContentBase64, fileType } = req.body || {};

    if (!fileContentBase64) {
      return res.status(400).json({ success: false, error: 'File content is required' });
    }

    const buffer = Buffer.from(fileContentBase64, 'base64');
    let extractedText = '';

    if (fileType === 'docx' || (fileName && fileName.endsWith('.docx'))) {
      const result = await mammoth.extractRawText({ buffer });
      extractedText = result.value;
    } else if (fileType === 'txt' || (fileName && fileName.endsWith('.txt'))) {
      extractedText = buffer.toString('utf-8');
    } else if (fileType === 'pdf' || (fileName && fileName.endsWith('.pdf'))) {
      const rawStr = buffer.toString('utf-8');
      const textMatches = rawStr.match(/\((.*?)\)\s*Tj/g) || rawStr.match(/\[(.*?)\]\s*TJ/g);
      if (textMatches && textMatches.length > 0) {
        extractedText = textMatches
          .map((m) => m.replace(/^[(\[]|[)\]]\s*T[jJ]$/g, ''))
          .join(' ')
          .replace(/\\([()\\])/g, '$1');
      } else {
        extractedText = buffer.toString('utf-8').replace(/[^\x20-\x7E\xC0-\xFF\n\r\t]/g, ' ');
      }
    } else {
      extractedText = buffer.toString('utf-8');
    }

    const cleanedText = extractedText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim();

    const sentences = splitGermanSentences(cleanedText);

    return res.json({
      success: true,
      data: {
        text: cleanedText,
        sentences,
        sentenceCount: sentences.length,
        wordCount: cleanedText.split(/\s+/).filter(Boolean).length,
      },
    });
  } catch (error: any) {
    console.error('Error parsing document:', error?.message || error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================
// SUPABASE PUBLIC CLIENT CONFIG (NO SECRET KEYS EVER EXPOSED)
// =============================================================
app.get('/api/supabase/config', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const rawKey = (
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();

  // Safety guard: never expose service_role or sb_secret_ keys to frontend
  const isSecretKey =
    rawKey.startsWith('sb_secret_') ||
    rawKey.toLowerCase().includes('service_role');

  const isPlaceholder =
    !url ||
    !rawKey ||
    url.includes('YOUR_PROJECT_REF') ||
    rawKey === 'MY_SUPABASE_PUBLISHABLE_KEY';

  const publishableKey = isSecretKey || isPlaceholder ? '' : rawKey;
  const configured = Boolean(url && publishableKey && /^https?:\/\//i.test(url));

  return res.json({
    success: true,
    data: {
      configured,
      url: configured ? url : '',
      publishableKey: configured ? publishableKey : '',
      bucket: 'german-learning',
    },
  });
});

// =============================================================
// ELEVENLABS SERVER-SIDE TTS APIs (ONLY PROVIDER)
// =============================================================

app.get('/api/tts/status', ttsReadLimiter, (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    success: true,
    data: {
      provider: 'elevenlabs',
      elevenLabsConfigured: Boolean(getElevenLabsApiKey()),
      model: DEFAULT_ELEVENLABS_MODEL,
      defaultFemaleVoiceId: DEFAULT_FEMALE_VOICE_ID,
      defaultMaleVoiceId: DEFAULT_MALE_VOICE_ID,
    },
  });
});

app.get('/api/tts/voices', ttsReadLimiter, (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    success: true,
    data: {
      provider: 'elevenlabs',
      model: DEFAULT_ELEVENLABS_MODEL,
      defaultFemaleVoiceId: DEFAULT_FEMALE_VOICE_ID,
      defaultMaleVoiceId: DEFAULT_MALE_VOICE_ID,
      elevenLabsConfigured: Boolean(getElevenLabsApiKey()),
      voices: VERIFIED_ELEVENLABS_VOICES,
    },
  });
});

// Synthesize German speech via official ElevenLabs API using server-side ELEVENLABS_API_KEY
app.post('/api/tts/synthesize', ttsWriteLimiter, async (req: Request, res: Response) => {
  try {
    const {
      text,
      model = DEFAULT_ELEVENLABS_MODEL,
      voiceId = DEFAULT_FEMALE_VOICE_ID,
    } = req.body || {};

    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_TEXT',
        error: 'النص مطلوب لتوليد الصوت عبر ElevenLabs.',
      });
    }

    const normalizedText = normalizeGermanText(text);
    if (normalizedText.length > 3500) {
      return res.status(400).json({
        success: false,
        code: 'TEXT_TOO_LONG',
        error: 'يتجاوز المقطع النصي الحد الأقصى البالغ 3,500 حرف.',
      });
    }

    const synth = await synthesizeWithElevenLabsServer({
      text: normalizedText,
      voiceId: typeof voiceId === 'string' && voiceId.trim() ? voiceId.trim() : DEFAULT_FEMALE_VOICE_ID,
      model: typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_ELEVENLABS_MODEL,
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', String(synth.buffer.length));
    res.setHeader('X-Audio-Source', 'Newly Generated ElevenLabs Audio');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(synth.buffer);
  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : 500;
    return res.status(status).json({
      success: false,
      code: err?.code || 'TTS_SYNTHESIS_FAILED',
      error: err?.message || 'تعذر توليد الصوت عبر ElevenLabs.',
    });
  }
});

// Test actual ElevenLabs audio generation from server (used in Settings verification)
app.post('/api/tts/test', ttsWriteLimiter, async (req: Request, res: Response) => {
  const start = Date.now();
  try {
    const sampleText =
      typeof req.body?.text === 'string' && req.body.text.trim()
        ? req.body.text.trim().slice(0, 200)
        : 'Hallo! Willkommen bei Deutsch Meister.';
    const voiceId =
      typeof req.body?.voiceId === 'string' && req.body.voiceId.trim()
        ? req.body.voiceId.trim()
        : DEFAULT_FEMALE_VOICE_ID;
    const model =
      typeof req.body?.model === 'string' && req.body.model.trim()
        ? req.body.model.trim()
        : DEFAULT_ELEVENLABS_MODEL;

    const synth = await synthesizeWithElevenLabsServer({
      text: sampleText,
      voiceId,
      model,
    });

    return res.json({
      success: true,
      data: {
        bytes: synth.buffer.length,
        contentType: synth.contentType,
        voiceId,
        model,
        latencyMs: Date.now() - start,
        audioBase64: synth.buffer.toString('base64'),
      },
    });
  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : 500;
    return res.status(status).json({
      success: false,
      code: err?.code || 'ELEVENLABS_TEST_FAILED',
      error: err?.message || 'فشل اختبار التوليد الصوتي عبر ElevenLabs.',
    });
  }
});

// Return JSON 404 for unknown API endpoints
app.all('/api/*', (_req: Request, res: Response) => {
  return res.status(404).json({ success: false, error: 'API endpoint not found' });
});

// -------------------------------------------------------------
// Vite Middleware / Static Server
// -------------------------------------------------------------
async function setupServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`[Deutsch Meister Server] Running on http://0.0.0.0:${port} (${isProd ? 'Production' : 'Development'})`);
  });
}

setupServer();
