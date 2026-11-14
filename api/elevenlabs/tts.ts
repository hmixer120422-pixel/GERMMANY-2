import { DEFAULT_ELEVENLABS_MODEL } from '../../src/services/elevenLabsConstants.js';
import { normalizeGermanText } from '../../src/utils/audioHash.js';
import {
  ElevenLabsServiceError,
  fetchElevenLabsVoicesServer,
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

    // If caller did not specify a voiceId, retrieve a valid German female voice from ElevenLabs
    let resolvedVoiceId = requestedVoiceId;
    if (!resolvedVoiceId) {
      const voiceCatalog = await fetchElevenLabsVoicesServer();
      resolvedVoiceId = voiceCatalog.defaultFemaleVoiceId;
    }

    const synth = await synthesizeWithElevenLabsServer({
      text: normalizedText,
      voiceId: resolvedVoiceId,
      model: requestedModel,
    });

    return sendBinary(res, 200, synth.contentType || 'audio/mpeg', synth.buffer, {
      'X-Audio-Source': 'Newly Generated ElevenLabs Audio',
      'X-ElevenLabs-Voice-Id': synth.voiceId,
      'X-ElevenLabs-Model': synth.model,
    });
  } catch (err: any) {
    const status = err instanceof ElevenLabsServiceError ? err.status : typeof err?.status === 'number' ? err.status : 500;
    return sendJson(res, status, {
      success: false,
      code: err?.code || 'TTS_SYNTHESIS_FAILED',
      error: err?.message || 'تعذر توليد الصوت عبر ElevenLabs.',
    });
  }
}
