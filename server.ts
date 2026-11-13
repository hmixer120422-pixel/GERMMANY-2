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
import { splitGermanSentences } from './src/utils/audioHash';
import {
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_FEMALE_VOICE_ID,
  DEFAULT_MALE_VOICE_ID,
} from './src/services/elevenLabsConstants';
import { getElevenLabsApiKey } from './api/_lib/elevenlabs';
import elevenLabsTtsHandler from './api/elevenlabs/tts';
import elevenLabsVoicesHandler from './api/elevenlabs/voices';
import elevenLabsTestHandler from './api/elevenlabs/test';
import { getSupabasePublicConfig } from './api/_lib/supabaseConfig';

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
  return res.json({
    success: true,
    data: getSupabasePublicConfig(),
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

app.get('/api/elevenlabs/voices', ttsReadLimiter, (req: Request, res: Response) =>
  elevenLabsVoicesHandler(req as any, res as any)
);

app.get('/api/tts/voices', ttsReadLimiter, (req: Request, res: Response) =>
  elevenLabsVoicesHandler(req as any, res as any)
);

// Primary ElevenLabs TTS endpoint (also mounted at /api/tts/synthesize for backwards compatibility)
app.post('/api/elevenlabs/tts', ttsWriteLimiter, (req: Request, res: Response) =>
  elevenLabsTtsHandler(req as any, res as any)
);

app.post('/api/tts/synthesize', ttsWriteLimiter, (req: Request, res: Response) =>
  elevenLabsTtsHandler(req as any, res as any)
);

// ElevenLabs full connection test (auth, voice availability, real MP3 generation)
app.post('/api/elevenlabs/test', ttsWriteLimiter, (req: Request, res: Response) =>
  elevenLabsTestHandler(req as any, res as any)
);

app.post('/api/tts/test', ttsWriteLimiter, (req: Request, res: Response) =>
  elevenLabsTestHandler(req as any, res as any)
);

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
