import {
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_FEMALE_VOICE_ID,
} from '../../src/services/elevenLabsConstants.js';
import {
  ElevenLabsServiceError,
  fetchElevenLabsVoicesServer,
  isMissingVoicesReadPermission,
  synthesizeWithElevenLabsServer,
} from '../_lib/elevenlabs.js';
import {
  applyApiSecurityHeaders,
  readJsonBody,
  sendBinary,
  sendJson,
  VercelLikeRequest,
  VercelLikeResponse,
} from '../_lib/http.js';
import { normalizeGermanText } from '../_lib/textNormalize.js';

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  applyApiSecurityHeaders(res);
  if (req.method !== 'POST') {
    return sendJson(res, 405, { success: false, error: 'Method not allowed' });
  }

  try {
    const body = await readJsonBody(req);
    const rawText = body?.text;
    const requestedVoiceId = typeof body?.voiceId === 'string' ? body.voiceId.trim() : '';
    const requestedModel =
      typeof body?.model === 'string' && body.model.trim()
        ? body.model.trim()
        : DEFAULT_ELEVENLABS_MODEL;
    const requestedMode =
      body?.mode === 'word' ? 'word' : body?.mode === 'sentence' ? 'sentence' : undefined;

    if (typeof rawText !== 'string' || !rawText.trim()) {
      return sendJson(res, 400, {
        success: false,
        code: 'INVALID_TEXT',
        error: 'النص الألماني مطلوب لتوليد الصوت عبر ElevenLabs.',
      });
    }

    const normalizedText = normalizeGermanText(rawText);
    if (!normalizedText) {
      return sendJson(res, 400, {
        success: false,
        code: 'INVALID_TEXT',
        error: 'النص المُرسل فارغ بعد التنظيف.',
      });
    }

    if (normalizedText.length > 3500) {
      return sendJson(res, 400, {
        success: false,
        code: 'TEXT_TOO_LONG',
        error: 'يتجاوز المقطع النصي الحد الأقصى البالغ 3,500 حرف.',
      });
    }

    let resolvedVoiceId = requestedVoiceId;
    if (!resolvedVoiceId) {
      try {
        const voiceCatalog = await fetchElevenLabsVoicesServer();
        resolvedVoiceId = voiceCatalog.defaultFemaleVoiceId;
      } catch (voiceErr) {
        if (isMissingVoicesReadPermission(voiceErr)) {
          resolvedVoiceId = DEFAULT_FEMALE_VOICE_ID;
        } else {
          throw voiceErr;
        }
      }
    }

    const synth = await synthesizeWithElevenLabsServer({
      text: normalizedText,
      voiceId: resolvedVoiceId,
      model: requestedModel,
      isSingleWord: requestedMode ? requestedMode === 'word' : undefined,
    });

    return sendBinary(res, 200, synth.contentType || 'audio/mpeg', synth.buffer, {
      'X-Audio-Source': 'Newly Generated ElevenLabs Audio',
      'X-ElevenLabs-Voice-Id': synth.voiceId,
      'X-ElevenLabs-Model': synth.model,
      'X-ElevenLabs-Output-Format': synth.outputFormat,
      'X-German-Enforced': synth.germanEnforced ? 'Hochdeutsch' : 'false',
      'X-German-Mode': synth.isSingleWord ? 'word' : 'sentence',
      ...(synth.requestId ? { 'X-ElevenLabs-Request-Id': synth.requestId } : {}),
    });
  } catch (err: any) {
    const status =
      err instanceof ElevenLabsServiceError
        ? err.status
        : typeof err?.status === 'number'
        ? err.status
        : 500;

    console.error('[Vercel /api/elevenlabs/tts] Error:', {
      status,
      code: err?.code || 'TTS_SYNTHESIS_FAILED',
      errorType: err?.errorType || err?.name || 'unknown_error',
      upstreamStatus: err?.upstreamStatus,
      upstreamMessage: err?.upstreamMessage,
      requestId: err?.requestId || null,
      stack: err?.stack,
    });

    return sendJson(res, status, {
      success: false,
      code: err?.code || 'TTS_SYNTHESIS_FAILED',
      errorType: err?.errorType || 'server_error',
      upstreamStatus: err?.upstreamStatus ?? null,
      upstreamMessage: err?.upstreamMessage ?? null,
      requestId: err?.requestId ?? null,
      error: err?.message || 'تعذر توليد الصوت عبر ElevenLabs.',
    });
  }
}
