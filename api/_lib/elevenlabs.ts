import {
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
  DEFAULT_FEMALE_VOICE_ID,
  VERIFIED_ELEVENLABS_VOICES,
} from '../../src/services/elevenLabsConstants';
import type { ElevenLabsVoiceOption, VoiceGender } from '../../src/types';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

export class ElevenLabsServiceError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly upstreamStatus?: number;

  constructor(message: string, code: string, status: number, upstreamStatus?: number) {
    super(message);
    this.name = 'ElevenLabsServiceError';
    this.code = code;
    this.status = status;
    this.upstreamStatus = upstreamStatus;
  }
}

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

async function parseErrorBody(res: Response): Promise<{ statusTag: string; detail: string }> {
  let detail = `ElevenLabs API error (HTTP ${res.status})`;
  let statusTag = '';
  try {
    const raw = await res.text();
    if (!raw) return { statusTag, detail };
    try {
      const json: any = JSON.parse(raw);
      if (json?.detail && typeof json.detail === 'object') {
        statusTag = String(json.detail.status || '');
        detail = String(json.detail.message || detail);
      } else if (typeof json?.detail === 'string') {
        detail = json.detail;
      } else if (json?.message) {
        detail = String(json.message);
      }
      if (json?.error && typeof json.error === 'string') {
        detail = json.error;
      }
    } catch {
      detail = raw.slice(0, 220);
    }
  } catch {
    // ignore read error
  }
  return { statusTag: statusTag.toLowerCase(), detail };
}

function buildElevenLabsError(httpStatus: number, statusTag: string, detail: string): ElevenLabsServiceError {
  const lower = `${statusTag} ${detail}`.toLowerCase();

  // Insufficient credits / quota exceeded (ElevenLabs often returns 401 or 402 or 429 with quota_exceeded)
  if (
    httpStatus === 402 ||
    lower.includes('quota_exceeded') ||
    lower.includes('insufficient') ||
    lower.includes('credit') ||
    lower.includes('character limit') ||
    lower.includes('exceeds your quota')
  ) {
    return new ElevenLabsServiceError(
      `رصيد ElevenLabs غير كافٍ لإتمام التوليد الصوتي: ${detail}`,
      'ELEVENLABS_INSUFFICIENT_CREDITS',
      402,
      httpStatus
    );
  }

  // Rate limiting / too many concurrent requests
  if (
    httpStatus === 429 ||
    lower.includes('too_many_requests') ||
    lower.includes('rate_limit') ||
    lower.includes('concurrent')
  ) {
    return new ElevenLabsServiceError(
      `تم تجاوز حد الطلبات المؤقت في ElevenLabs. يرجى الانتظار قليلاً ثم إعادة المحاولة (${detail}).`,
      'ELEVENLABS_RATE_LIMIT',
      429,
      httpStatus
    );
  }

  // Invalid / missing voice ID
  if (
    httpStatus === 404 ||
    lower.includes('voice_not_found') ||
    lower.includes('voice id') ||
    (httpStatus === 400 && lower.includes('voice')) ||
    lower.includes('invalid_uid')
  ) {
    return new ElevenLabsServiceError(
      `معرّف الصوت (Voice ID) غير صالح أو غير متاح في حساب ElevenLabs: ${detail}`,
      'ELEVENLABS_INVALID_VOICE',
      400,
      httpStatus
    );
  }

  // Invalid / unauthorized API key
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    lower.includes('invalid_api_key') ||
    lower.includes('invalid api key') ||
    lower.includes('unauthorized') ||
    lower.includes('missing_permissions')
  ) {
    return new ElevenLabsServiceError(
      `فشل التحقق من مفتاح ELEVENLABS_API_KEY على الخادم: ${detail}`,
      'ELEVENLABS_AUTH_ERROR',
      502,
      httpStatus
    );
  }

  return new ElevenLabsServiceError(
    `تعذر توليد الصوت عبر ElevenLabs (HTTP ${httpStatus}): ${detail}`,
    'ELEVENLABS_API_ERROR',
    httpStatus >= 400 && httpStatus < 500 ? httpStatus : 502,
    httpStatus
  );
}

async function fetchElevenLabsWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = 25000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new ElevenLabsServiceError(
        'انتهت مهلة الاتصال بخدمة ElevenLabs. يرجى التحقق من الشبكة والمحاولة مرة أخرى.',
        'ELEVENLABS_NETWORK_TIMEOUT',
        504
      );
    }
    throw new ElevenLabsServiceError(
      `خطأ في الشبكة أثناء الاتصال بخدمة ElevenLabs: ${err?.message || 'Network failure'}`,
      'ELEVENLABS_NETWORK_ERROR',
      502
    );
  } finally {
    clearTimeout(timer);
  }
}

function inferGender(rawVoice: any): VoiceGender {
  const genderLabel = String(rawVoice?.labels?.gender || '').toLowerCase();
  if (genderLabel === 'male' || genderLabel === 'man') return 'male';
  if (genderLabel === 'female' || genderLabel === 'woman') return 'female';

  const name = String(rawVoice?.name || '').toLowerCase();
  const maleHints = ['antoni', 'adam', 'daniel', 'josh', 'arnold', 'sam', 'callum', 'charlie', 'clyde', 'dave', 'ethan', 'fin', 'george', 'harry', 'james', 'jeremy', 'joseph', 'liam', 'marcus', 'michael', 'patrick', 'thomas', 'will', 'brian', 'bill', 'chris', 'eric'];
  if (maleHints.some((hint) => name.includes(hint))) return 'male';
  return 'female';
}

function scoreGermanFemaleVoice(rawVoice: any): number {
  const gender = inferGender(rawVoice);
  if (gender !== 'female') return -100;

  let score = 10;
  const labels = rawVoice?.labels || {};
  const language = String(labels.language || '').toLowerCase();
  const accent = String(labels.accent || '').toLowerCase();
  const description = String(labels.description || rawVoice?.description || '').toLowerCase();
  const name = String(rawVoice?.name || '').toLowerCase();
  const useCase = String(labels.use_case || '').toLowerCase();
  const verifiedLangs = Array.isArray(rawVoice?.verified_languages)
    ? rawVoice.verified_languages.map((l: any) => String(l?.language || '').toLowerCase())
    : [];

  if (language === 'de' || language.includes('german') || verifiedLangs.includes('de')) {
    score += 100;
  }
  if (accent.includes('german')) score += 60;
  if (description.includes('german') || description.includes('hochdeutsch')) score += 40;
  if (name.includes('sarah')) score += 30;
  if (name.includes('laura')) score += 25;
  if (name.includes('alice')) score += 20;
  if (name.includes('rachel') || name.includes('charlotte') || name.includes('matilda')) score += 15;
  if (useCase.includes('narration') || useCase.includes('conversational') || useCase.includes('informative')) score += 10;
  if (rawVoice?.category === 'premade') score += 5;
  return score;
}

export async function fetchElevenLabsVoicesServer(): Promise<{
  voices: ElevenLabsVoiceOption[];
  defaultFemaleVoiceId: string;
  defaultMaleVoiceId: string;
  source: 'elevenlabs-live' | 'fallback';
}> {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new ElevenLabsServiceError(
      'مفتاح ELEVENLABS_API_KEY غير مضبوط على الخادم. يرجى إضافته في متغيرات البيئة (Environment Variables).',
      'ELEVENLABS_NOT_CONFIGURED',
      503
    );
  }

  const res = await fetchElevenLabsWithTimeout(
    `${ELEVENLABS_BASE_URL}/voices`,
    {
      method: 'GET',
      headers: {
        'xi-api-key': apiKey,
        Accept: 'application/json',
      },
    },
    15000
  );

  if (!res.ok) {
    const { statusTag, detail } = await parseErrorBody(res);
    throw buildElevenLabsError(res.status, statusTag, detail);
  }

  const data: any = await res.json();
  const rawVoices: any[] = Array.isArray(data?.voices) ? data.voices : [];
  if (rawVoices.length === 0) {
    throw new ElevenLabsServiceError(
      'لم يُعد حساب ElevenLabs أي أصوات متاحة.',
      'ELEVENLABS_NO_VOICES',
      502
    );
  }

  // Pick best German/multilingual female voice from live ElevenLabs account
  const sortedFemale = [...rawVoices]
    .filter((v) => inferGender(v) === 'female')
    .sort((a, b) => scoreGermanFemaleVoice(b) - scoreGermanFemaleVoice(a));

  const bestFemale = sortedFemale[0] || rawVoices[0];
  const bestMale = rawVoices.find((v) => inferGender(v) === 'male') || rawVoices[0];

  const mapped: ElevenLabsVoiceOption[] = rawVoices
    .map((v) => {
      const gender = inferGender(v);
      const isDefaultFemale = v.voice_id === bestFemale.voice_id;
      const accent = v?.labels?.accent ? ` (${v.labels.accent})` : '';
      const desc =
        v?.labels?.description ||
        v?.description ||
        (gender === 'female'
          ? 'صوت نسائي متوافق مع اللغة الألمانية عبر ElevenLabs Multilingual v2'
          : 'صوت ذكوري متوافق مع اللغة الألمانية عبر ElevenLabs Multilingual v2');

      return {
        voiceId: String(v.voice_id),
        name: String(v.name || v.voice_id),
        labelArabic: `${v.name || v.voice_id}${accent} — ${gender === 'female' ? 'نسائي' : 'ذكوري'}`,
        gender,
        description: String(desc),
        model: DEFAULT_ELEVENLABS_MODEL,
        isDefaultFemale,
      };
    })
    .sort((a, b) => {
      if (a.isDefaultFemale && !b.isDefaultFemale) return -1;
      if (!a.isDefaultFemale && b.isDefaultFemale) return 1;
      if (a.gender === 'female' && b.gender !== 'female') return -1;
      if (a.gender !== 'female' && b.gender === 'female') return 1;
      return a.name.localeCompare(b.name);
    });

  return {
    voices: mapped,
    defaultFemaleVoiceId: String(bestFemale.voice_id || DEFAULT_FEMALE_VOICE_ID),
    defaultMaleVoiceId: String(bestMale.voice_id || bestFemale.voice_id || DEFAULT_FEMALE_VOICE_ID),
    source: 'elevenlabs-live',
  };
}

export async function fetchElevenLabsQuotaSummary(): Promise<{
  characterCount?: number;
  characterLimit?: number;
  remainingCharacters?: number;
  tier?: string;
} | null> {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) return null;
  try {
    const res = await fetchElevenLabsWithTimeout(
      `${ELEVENLABS_BASE_URL}/user/subscription`,
      {
        method: 'GET',
        headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
      },
      10000
    );
    if (!res.ok) return null;
    const sub: any = await res.json();
    const count = typeof sub?.character_count === 'number' ? sub.character_count : undefined;
    const limit = typeof sub?.character_limit === 'number' ? sub.character_limit : undefined;
    return {
      characterCount: count,
      characterLimit: limit,
      remainingCharacters:
        typeof count === 'number' && typeof limit === 'number' ? Math.max(0, limit - count) : undefined,
      tier: typeof sub?.tier === 'string' ? sub.tier : undefined,
    };
  } catch {
    return null;
  }
}

export async function synthesizeWithElevenLabsServer(params: {
  text: string;
  voiceId: string;
  model?: string;
  outputFormat?: string;
}): Promise<{ buffer: Buffer; contentType: string; voiceId: string; model: string }> {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new ElevenLabsServiceError(
      'مفتاح ELEVENLABS_API_KEY غير مضبوط على الخادم. يرجى إضافته في إعدادات البيئة لتفعيل الصوت.',
      'ELEVENLABS_NOT_CONFIGURED',
      503
    );
  }

  const rawVoiceId = typeof params.voiceId === 'string' ? params.voiceId.trim() : '';
  if (!rawVoiceId || !/^[A-Za-z0-9_-]{8,64}$/.test(rawVoiceId)) {
    throw new ElevenLabsServiceError(
      `معرّف الصوت (Voice ID) غير صالح: "${rawVoiceId || 'فارغ'}"`,
      'ELEVENLABS_INVALID_VOICE',
      400
    );
  }

  const resolvedModel = (params.model || DEFAULT_ELEVENLABS_MODEL).trim() || DEFAULT_ELEVENLABS_MODEL;
  const outputFormat = params.outputFormat || DEFAULT_ELEVENLABS_OUTPUT_FORMAT;
  const endpoint = `${ELEVENLABS_BASE_URL}/text-to-speech/${encodeURIComponent(
    rawVoiceId
  )}?output_format=${encodeURIComponent(outputFormat)}`;

  const elRes = await fetchElevenLabsWithTimeout(
    endpoint,
    {
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
    },
    28000
  );

  if (!elRes.ok) {
    const { statusTag, detail } = await parseErrorBody(elRes);
    throw buildElevenLabsError(elRes.status, statusTag, detail);
  }

  const arrayBuf = await elRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  if (!isValidMp3Buffer(buffer)) {
    throw new ElevenLabsServiceError(
      'أعاد ElevenLabs استجابة فارغة أو ملفاً صوتياً غير صالح.',
      'INVALID_MP3_RESPONSE',
      502
    );
  }

  return {
    buffer,
    contentType: elRes.headers.get('content-type') || 'audio/mpeg',
    voiceId: rawVoiceId,
    model: resolvedModel,
  };
}

export function getFallbackVoicesSnapshot() {
  return {
    voices: VERIFIED_ELEVENLABS_VOICES,
    defaultFemaleVoiceId: DEFAULT_FEMALE_VOICE_ID,
    defaultMaleVoiceId: VERIFIED_ELEVENLABS_VOICES.find((v) => v.gender === 'male')?.voiceId || DEFAULT_FEMALE_VOICE_ID,
    source: 'fallback' as const,
  };
}
