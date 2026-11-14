import {
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
  DEFAULT_FEMALE_VOICE_ID,
  VERIFIED_ELEVENLABS_VOICES,
} from '../../src/services/elevenLabsConstants.js';
import type { ElevenLabsVoiceOption, VoiceGender } from '../../src/types/index.js';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
const RETRYABLE_HTTP_STATUSES = new Set([500, 502, 503, 504]);
const MAX_RETRY_ATTEMPTS = 2; // total 3 attempts

export class ElevenLabsServiceError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly errorType: string;
  public readonly upstreamStatus?: number;
  public readonly upstreamMessage?: string;
  public readonly requestId?: string | null;

  constructor(params: {
    message: string;
    code: string;
    status: number;
    errorType: string;
    upstreamStatus?: number;
    upstreamMessage?: string;
    requestId?: string | null;
  }) {
    super(params.message);
    this.name = 'ElevenLabsServiceError';
    this.code = params.code;
    this.status = params.status;
    this.errorType = params.errorType;
    this.upstreamStatus = params.upstreamStatus;
    this.upstreamMessage = params.upstreamMessage;
    this.requestId = params.requestId ?? null;
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
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseErrorBody(
  res: Response
): Promise<{ statusTag: string; errorType: string; detail: string; requestId: string | null }> {
  const requestId =
    res.headers.get('request-id') ||
    res.headers.get('x-request-id') ||
    res.headers.get('elevenlabs-request-id') ||
    null;

  let detail = `ElevenLabs API error (HTTP ${res.status})`;
  let statusTag = '';
  let errorType = 'elevenlabs_http_error';

  try {
    const raw = await res.text();
    if (!raw) return { statusTag, errorType, detail, requestId };
    try {
      const json: any = JSON.parse(raw);
      if (json?.detail && typeof json.detail === 'object') {
        statusTag = String(json.detail.status || '');
        errorType = statusTag || errorType;
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
      detail = raw.slice(0, 260);
    }
  } catch {
    // ignore stream read error
  }

  return {
    statusTag: statusTag.toLowerCase(),
    errorType,
    detail,
    requestId,
  };
}

function buildElevenLabsError(
  httpStatus: number,
  parsed: { statusTag: string; errorType: string; detail: string; requestId: string | null }
): ElevenLabsServiceError {
  const { statusTag, errorType, detail, requestId } = parsed;
  const lower = `${statusTag} ${detail}`.toLowerCase();

  // Preserve ElevenLabs' original HTTP status on client/upstream errors
  if (
    httpStatus === 402 ||
    lower.includes('quota_exceeded') ||
    lower.includes('insufficient') ||
    lower.includes('credit') ||
    lower.includes('character limit') ||
    lower.includes('exceeds your quota')
  ) {
    return new ElevenLabsServiceError({
      message: `رصيد ElevenLabs غير كافٍ لإتمام التوليد الصوتي: ${detail}`,
      code: 'ELEVENLABS_INSUFFICIENT_CREDITS',
      errorType: statusTag || 'quota_exceeded',
      status: httpStatus,
      upstreamStatus: httpStatus,
      upstreamMessage: detail,
      requestId,
    });
  }

  if (
    httpStatus === 429 ||
    lower.includes('too_many_requests') ||
    lower.includes('rate_limit') ||
    lower.includes('concurrent')
  ) {
    return new ElevenLabsServiceError({
      message: `تم تجاوز حد الطلبات المؤقت في ElevenLabs. يرجى الانتار قليلاً ثم إعادة المحاولة (${detail}).`,
      code: 'ELEVENLABS_RATE_LIMIT',
      errorType: statusTag || 'rate_limit_exceeded',
      status: httpStatus,
      upstreamStatus: httpStatus,
      upstreamMessage: detail,
      requestId,
    });
  }

  if (
    httpStatus === 404 ||
    lower.includes('voice_not_found') ||
    lower.includes('voice id') ||
    (httpStatus === 400 && lower.includes('voice')) ||
    lower.includes('invalid_uid')
  ) {
    return new ElevenLabsServiceError({
      message: `معرّف الصوت (Voice ID) غير صالح أو غير متاح في حساب ElevenLabs: ${detail}`,
      code: 'ELEVENLABS_INVALID_VOICE',
      errorType: statusTag || 'voice_not_found',
      status: httpStatus,
      upstreamStatus: httpStatus,
      upstreamMessage: detail,
      requestId,
    });
  }

  if (lower.includes('missing_permissions') || statusTag === 'missing_permissions') {
    return new ElevenLabsServiceError({
      message: `مفتاح ELEVENLABS_API_KEY لا يملك الصلاحية المطلوبة لهذه العملية: ${detail}. فعّل صلاحيتي Text to Speech و Voices (Read) من لوحة ElevenLabs.`,
      code: 'ELEVENLABS_MISSING_PERMISSION',
      errorType: 'missing_permissions',
      status: httpStatus,
      upstreamStatus: httpStatus,
      upstreamMessage: detail,
      requestId,
    });
  }

  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    lower.includes('invalid_api_key') ||
    lower.includes('invalid api key') ||
    lower.includes('unauthorized')
  ) {
    return new ElevenLabsServiceError({
      message: `فشل التحقق من مفتاح ELEVENLABS_API_KEY على الخادم: ${detail}`,
      code: 'ELEVENLABS_AUTH_ERROR',
      errorType: statusTag || 'invalid_api_key',
      status: httpStatus,
      upstreamStatus: httpStatus,
      upstreamMessage: detail,
      requestId,
    });
  }

  return new ElevenLabsServiceError({
    message: `تعذر توليد الصوت عبر ElevenLabs (HTTP ${httpStatus}): ${detail}`,
    code: RETRYABLE_HTTP_STATUSES.has(httpStatus)
      ? 'ELEVENLABS_UPSTREAM_UNAVAILABLE'
      : 'ELEVENLABS_API_ERROR',
    errorType,
    status: httpStatus,
    upstreamStatus: httpStatus,
    upstreamMessage: detail,
    requestId,
  });
}

export function isMissingVoicesReadPermission(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { errorType?: string; code?: string; upstreamMessage?: string; message?: string };
  if (e.errorType === 'missing_permissions' || e.code === 'ELEVENLABS_MISSING_PERMISSION') {
    return true;
  }
  const msg = `${e.upstreamMessage || ''} ${e.message || ''}`.toLowerCase();
  return msg.includes('voices_read') || msg.includes('missing_permissions');
}

function logElevenLabsDiagnostic(context: string, info: Record<string, unknown>): void {
  // Never log API keys or secrets
  console.error(`[ElevenLabs Diagnostic] ${context}:`, JSON.stringify(info));
}

async function fetchElevenLabsWithRetry(
  url: string,
  init: RequestInit,
  context: string,
  timeoutMs: number = 25000
): Promise<Response> {
  let lastNetworkErr: ElevenLabsServiceError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      const backoffMs = 400 * Math.pow(2, attempt - 1);
      await sleep(backoffMs);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (RETRYABLE_HTTP_STATUSES.has(res.status) && attempt < MAX_RETRY_ATTEMPTS) {
        const parsed = await parseErrorBody(res);
        logElevenLabsDiagnostic(`${context} retryable HTTP ${res.status} (attempt ${attempt + 1})`, {
          httpStatus: res.status,
          errorType: parsed.errorType,
          upstreamMessage: parsed.detail,
          requestId: parsed.requestId,
        });
        continue;
      }

      return res;
    } catch (err: any) {
      const isTimeout = err?.name === 'AbortError';
      lastNetworkErr = new ElevenLabsServiceError({
        message: isTimeout
          ? 'انتهت مهلة الاتصال بخدمة ElevenLabs. يرجى التحقق من الشبكة والمحاولة مرة أخرى.'
          : `خطأ في الشبكة أثناء الاتصال بخدمة ElevenLabs: ${err?.message || 'Network failure'}`,
        code: isTimeout ? 'ELEVENLABS_NETWORK_TIMEOUT' : 'ELEVENLABS_NETWORK_ERROR',
        errorType: isTimeout ? 'timeout' : 'network_error',
        status: isTimeout ? 504 : 502,
        upstreamMessage: err?.message || 'Network failure',
      });

      logElevenLabsDiagnostic(`${context} network error (attempt ${attempt + 1})`, {
        code: lastNetworkErr.code,
        errorType: lastNetworkErr.errorType,
        message: err?.message,
        stack: err?.stack,
      });

      if (attempt >= MAX_RETRY_ATTEMPTS) {
        throw lastNetworkErr;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw (
    lastNetworkErr ||
    new ElevenLabsServiceError({
      message: 'تعذر الاتصال بخدمة ElevenLabs بعد عدة محاولات.',
      code: 'ELEVENLABS_NETWORK_ERROR',
      errorType: 'network_error',
      status: 502,
    })
  );
}

function inferGender(rawVoice: any): VoiceGender {
  const genderLabel = String(rawVoice?.labels?.gender || '').toLowerCase();
  if (genderLabel === 'male' || genderLabel === 'man') return 'male';
  if (genderLabel === 'female' || genderLabel === 'woman') return 'female';

  const name = String(rawVoice?.name || '').toLowerCase();
  const maleHints = [
    'antoni',
    'adam',
    'daniel',
    'josh',
    'arnold',
    'sam',
    'callum',
    'charlie',
    'clyde',
    'dave',
    'ethan',
    'fin',
    'george',
    'harry',
    'james',
    'jeremy',
    'joseph',
    'liam',
    'marcus',
    'michael',
    'patrick',
    'thomas',
    'will',
    'brian',
    'bill',
    'chris',
    'eric',
  ];
  if (maleHints.some((hint) => name.includes(hint))) return 'male';
  return 'female';
}

function scoreGermanVoice(rawVoice: any): { score: number; isNativeGerman: boolean } {
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

  const isNativeGerman =
    language === 'de' ||
    language === 'de-de' ||
    language.includes('german') ||
    accent.includes('german') ||
    accent.includes('hochdeutsch') ||
    verifiedLangs.includes('de') ||
    verifiedLangs.includes('de-de');

  if (language === 'de' || language === 'de-de' || language.includes('german')) {
    score += 120;
  }
  if (verifiedLangs.includes('de') || verifiedLangs.includes('de-de')) {
    score += 100;
  }
  if (accent.includes('german') || accent.includes('hochdeutsch')) score += 80;
  if (description.includes('german') || description.includes('hochdeutsch') || description.includes('deutsch')) {
    score += 50;
  }
  if (name.includes('sarah')) score += 30;
  if (name.includes('laura')) score += 25;
  if (name.includes('alice')) score += 20;
  if (name.includes('daniel') || name.includes('adam') || name.includes('antoni')) score += 20;
  if (name.includes('rachel') || name.includes('charlotte') || name.includes('matilda')) score += 15;
  if (useCase.includes('narration') || useCase.includes('conversational') || useCase.includes('informative')) score += 10;
  if (rawVoice?.category === 'premade') score += 5;

  return { score, isNativeGerman };
}

export async function fetchElevenLabsVoicesServer(): Promise<{
  voices: ElevenLabsVoiceOption[];
  defaultFemaleVoiceId: string;
  defaultMaleVoiceId: string;
  source: 'elevenlabs-live' | 'fallback';
}> {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new ElevenLabsServiceError({
      message:
        'مفتاح ELEVENLABS_API_KEY غير مضبوط على الخادم. يرجى إضافته في متغيرات البيئة (Environment Variables).',
      code: 'ELEVENLABS_NOT_CONFIGURED',
      errorType: 'missing_api_key',
      status: 503,
    });
  }

  const res = await fetchElevenLabsWithRetry(
    `${ELEVENLABS_BASE_URL}/voices`,
    {
      method: 'GET',
      headers: {
        'xi-api-key': apiKey,
        Accept: 'application/json',
      },
    },
    'GET /v1/voices',
    15000
  );

  if (!res.ok) {
    const parsed = await parseErrorBody(res);
    const err = buildElevenLabsError(res.status, parsed);
    if (isMissingVoicesReadPermission(err)) {
      console.warn(
        '[ElevenLabs] API key lacks voices_read permission; falling back to verified German voice presets.'
      );
    } else {
      logElevenLabsDiagnostic('GET /v1/voices failed', {
        httpStatus: res.status,
        errorCode: err.code,
        errorType: err.errorType,
        upstreamMessage: parsed.detail,
        requestId: parsed.requestId,
      });
    }
    throw err;
  }

  const data: any = await res.json();
  const rawVoices: any[] = Array.isArray(data?.voices) ? data.voices : [];
  if (rawVoices.length === 0) {
    throw new ElevenLabsServiceError({
      message: 'لم يُعد حساب ElevenLabs أي أصوات متاحة.',
      code: 'ELEVENLABS_NO_VOICES',
      errorType: 'empty_voices',
      status: 502,
    });
  }

  const scoreById = new Map<string, { score: number; isNativeGerman: boolean }>();
  for (const v of rawVoices) {
    scoreById.set(String(v.voice_id), scoreGermanVoice(v));
  }

  const sortedFemale = [...rawVoices]
    .filter((v) => inferGender(v) === 'female')
    .sort((a, b) => (scoreById.get(String(b.voice_id))?.score || 0) - (scoreById.get(String(a.voice_id))?.score || 0));

  const sortedMale = [...rawVoices]
    .filter((v) => inferGender(v) === 'male')
    .sort((a, b) => (scoreById.get(String(b.voice_id))?.score || 0) - (scoreById.get(String(a.voice_id))?.score || 0));

  const bestFemale = sortedFemale[0] || rawVoices[0];
  const bestMale = sortedMale[0] || bestFemale;

  const mapped: ElevenLabsVoiceOption[] = rawVoices
    .map((v) => {
      const gender = inferGender(v);
      const id = String(v.voice_id);
      const meta = scoreById.get(id) || { score: 0, isNativeGerman: false };
      const isDefaultFemale = id === String(bestFemale.voice_id);
      const accent = v?.labels?.accent ? ` (${v.labels.accent})` : '';
      const nativeBadge = meta.isNativeGerman ? ' • ألماني أصلي (DE)' : '';
      const desc =
        v?.labels?.description ||
        v?.description ||
        (gender === 'female'
          ? 'صوت نسائي متوافق مع النطق الألماني الفصيح (Hochdeutsch)'
          : 'صوت ذكوري متوافق مع النطق الألماني الفصيح (Hochdeutsch)');

      return {
        voiceId: id,
        name: String(v.name || id),
        labelArabic: `${v.name || id}${accent} — ${gender === 'female' ? 'نسائي' : 'ذكوري'}${nativeBadge}`,
        gender,
        description: String(desc),
        model: DEFAULT_ELEVENLABS_MODEL,
        isDefaultFemale,
      };
    })
    .sort((a, b) => {
      if (a.isDefaultFemale && !b.isDefaultFemale) return -1;
      if (!a.isDefaultFemale && b.isDefaultFemale) return 1;
      const aScore = scoreById.get(a.voiceId)?.score || 0;
      const bScore = scoreById.get(b.voiceId)?.score || 0;
      if (aScore !== bScore) return bScore - aScore;
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
    const res = await fetchElevenLabsWithRetry(
      `${ELEVENLABS_BASE_URL}/user/subscription`,
      {
        method: 'GET',
        headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
      },
      'GET /v1/user/subscription',
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

export function supportsExplicitLanguageCode(modelId: string): boolean {
  const lower = String(modelId || '').toLowerCase();
  // eleven_multilingual_v2 / v1 reject `language_code` with HTTP 400;
  // turbo_v2_5, flash_v2_5 and eleven_v3 explicitly support `language_code: "de"`.
  return lower.includes('turbo_v2_5') || lower.includes('flash_v2_5') || lower.includes('eleven_v3');
}

export function buildElevenLabsTtsPayload(params: {
  text: string;
  model?: string;
  isSingleWord?: boolean;
}): {
  text: string;
  model_id: string;
  language_code?: 'de';
  previous_text: string;
  next_text?: string;
  voice_settings: {
    stability: number;
    similarity_boost: number;
    style: number;
    use_speaker_boost: boolean;
  };
  isSingleWord: boolean;
} {
  const cleanText = String(params.text || '').trim();
  const resolvedModel = (params.model || DEFAULT_ELEVENLABS_MODEL).trim() || DEFAULT_ELEVENLABS_MODEL;
  const wordTokens = cleanText.split(/\s+/).filter(Boolean);
  const isSingleWord =
    typeof params.isSingleWord === 'boolean'
      ? params.isSingleWord
      : wordTokens.length <= 2 && !/[.!?]/.test(cleanText.slice(0, -1));

  // Unspoken Standard German (Hochdeutsch) conditioning context prevents ElevenLabs
  // from misreading short/ambiguous isolated words (e.g. "Hand", "Kind", "in", "an", "so", "fast", "Gift")
  // with English phonetics or clipped word endings.
  const payload: {
    text: string;
    model_id: string;
    language_code?: 'de';
    previous_text: string;
    next_text?: string;
    voice_settings: {
      stability: number;
      similarity_boost: number;
      style: number;
      use_speaker_boost: boolean;
    };
    isSingleWord: boolean;
  } = isSingleWord
    ? {
        text: cleanText,
        model_id: resolvedModel,
        previous_text:
          'Auf klarem Standarddeutsch (Hochdeutsch) spricht man dieses einzelne deutsche Wort deutlich und authentisch aus: „',
        next_text: '“.',
        voice_settings: {
          stability: 0.85,
          similarity_boost: 0.8,
          style: 0.0,
          use_speaker_boost: true,
        },
        isSingleWord: true,
      }
    : {
        text: cleanText,
        model_id: resolvedModel,
        previous_text: 'Auf klarem Standarddeutsch (Hochdeutsch) wird dieser Text natürlich vorgelesen: ',
        voice_settings: {
          stability: 0.68,
          similarity_boost: 0.78,
          style: 0.0,
          use_speaker_boost: true,
        },
        isSingleWord: false,
      };

  if (supportsExplicitLanguageCode(resolvedModel)) {
    payload.language_code = 'de';
  }

  return payload;
}

export async function synthesizeWithElevenLabsServer(params: {
  text: string;
  voiceId: string;
  model?: string;
  outputFormat?: string;
  isSingleWord?: boolean;
}): Promise<{
  buffer: Buffer;
  contentType: string;
  outputFormat: string;
  voiceId: string;
  model: string;
  requestId: string | null;
  germanEnforced: boolean;
  isSingleWord: boolean;
}> {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new ElevenLabsServiceError({
      message:
        'مفتاح ELEVENLABS_API_KEY غير مضبوط على الخادم. يرجى إضافته في إعدادات البيئة لتفعيل الصوت.',
      code: 'ELEVENLABS_NOT_CONFIGURED',
      errorType: 'missing_api_key',
      status: 503,
    });
  }

  const rawVoiceId = typeof params.voiceId === 'string' ? params.voiceId.trim() : '';
  if (!rawVoiceId || !/^[A-Za-z0-9_-]{8,64}$/.test(rawVoiceId)) {
    throw new ElevenLabsServiceError({
      message: `معرّف الصوت (Voice ID) غير صالح: "${rawVoiceId || 'فارغ'}"`,
      code: 'ELEVENLABS_INVALID_VOICE',
      errorType: 'invalid_voice_id',
      status: 400,
    });
  }

  const payload = buildElevenLabsTtsPayload({
    text: params.text,
    model: params.model,
    isSingleWord: params.isSingleWord,
  });
  const resolvedModel = payload.model_id;
  const outputFormat = (params.outputFormat || DEFAULT_ELEVENLABS_OUTPUT_FORMAT).trim() || 'mp3_44100_128';

  const requestBody: Record<string, unknown> = {
    text: payload.text,
    model_id: payload.model_id,
    previous_text: payload.previous_text,
    voice_settings: payload.voice_settings,
  };
  if (payload.next_text) {
    requestBody.next_text = payload.next_text;
  }
  if (payload.language_code) {
    requestBody.language_code = payload.language_code;
  }

  const endpoint = `${ELEVENLABS_BASE_URL}/text-to-speech/${encodeURIComponent(
    rawVoiceId
  )}?output_format=${encodeURIComponent(outputFormat)}`;

  const elRes = await fetchElevenLabsWithRetry(
    endpoint,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(requestBody),
    },
    `POST /v1/text-to-speech/${rawVoiceId}`,
    28000
  );

  const requestId =
    elRes.headers.get('request-id') ||
    elRes.headers.get('x-request-id') ||
    elRes.headers.get('elevenlabs-request-id') ||
    null;

  if (!elRes.ok) {
    const parsed = await parseErrorBody(elRes);
    const err = buildElevenLabsError(elRes.status, parsed);
    logElevenLabsDiagnostic('POST /v1/text-to-speech failed', {
      httpStatus: elRes.status,
      errorCode: err.code,
      errorType: err.errorType,
      upstreamMessage: parsed.detail,
      requestId: parsed.requestId,
      voiceId: rawVoiceId,
      modelId: resolvedModel,
      outputFormat,
    });
    throw err;
  }

  const responseContentType = (elRes.headers.get('content-type') || '').toLowerCase();
  if (responseContentType.includes('application/json')) {
    const parsed = await parseErrorBody(elRes);
    const err = new ElevenLabsServiceError({
      message: `أعاد ElevenLabs استجابة JSON بدلاً من الصوت: ${parsed.detail}`,
      code: 'ELEVENLABS_UNEXPECTED_JSON',
      errorType: parsed.errorType,
      status: 502,
      upstreamStatus: elRes.status,
      upstreamMessage: parsed.detail,
      requestId: parsed.requestId,
    });
    logElevenLabsDiagnostic('POST /v1/text-to-speech unexpected JSON', {
      httpStatus: elRes.status,
      requestId: parsed.requestId,
      upstreamMessage: parsed.detail,
    });
    throw err;
  }

  const arrayBuf = await elRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);

  if (!isValidMp3Buffer(buffer)) {
    const err = new ElevenLabsServiceError({
      message: 'أعاد ElevenLabs استجابة فارغة أو ملفاً صوتياً غير صالح.',
      code: 'INVALID_AUDIO_RESPONSE',
      errorType: 'invalid_audio_payload',
      status: 502,
      upstreamStatus: elRes.status,
      requestId,
    });
    logElevenLabsDiagnostic('POST /v1/text-to-speech invalid audio buffer', {
      httpStatus: elRes.status,
      bytes: buffer.length,
      contentType: responseContentType,
      requestId,
    });
    throw err;
  }

  return {
    buffer,
    contentType: 'audio/mpeg',
    outputFormat,
    voiceId: rawVoiceId,
    model: resolvedModel,
    requestId,
    germanEnforced: true,
    isSingleWord: payload.isSingleWord,
  };
}

export function getFallbackVoicesSnapshot() {
  return {
    voices: VERIFIED_ELEVENLABS_VOICES,
    defaultFemaleVoiceId: DEFAULT_FEMALE_VOICE_ID,
    defaultMaleVoiceId:
      VERIFIED_ELEVENLABS_VOICES.find((v) => v.gender === 'male')?.voiceId || DEFAULT_FEMALE_VOICE_ID,
    source: 'fallback' as const,
  };
}
