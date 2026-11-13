import {
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_FEMALE_VOICE_ID,
} from '../../src/services/elevenLabsVoices';

export function getElevenLabsApiKey(): string | null {
  const raw = process.env.ELEVENLABS_API_KEY?.trim();
  if (!raw) return null;
  const key = raw.replace(/^(['"])(.*)\1$/, '$2').trim();
  if (!key || key === 'MY_ELEVENLABS_API_KEY') return null;
  return key;
}

export function isValidMp3Buffer(buf: Buffer): boolean {
  if (!buf || buf.length < 128) return false;
  // ID3v2 header
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;
  // MPEG frame sync (11 bits set: 0xFF followed by 0xE0..0xFF)
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true;
  return false;
}

export async function synthesizeWithElevenLabsServer(params: {
  text: string;
  voiceId: string;
  model: string;
  outputFormat?: string;
}): Promise<{ buffer: Buffer; contentType: string }> {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    const err: any = new Error(
      'مفتاح ELEVENLABS_API_KEY غير مضبوط على الخادم. يرجى إضافته في إعدادات البيئة لتفعيل الصوت.'
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
