import { DEFAULT_ELEVENLABS_MODEL } from '../../src/services/elevenLabsConstants.js';
import {
  ElevenLabsServiceError,
  fetchElevenLabsQuotaSummary,
  fetchElevenLabsVoicesServer,
  getFallbackVoicesSnapshot,
  isMissingVoicesReadPermission,
  synthesizeWithElevenLabsServer,
} from '../_lib/elevenlabs.js';
import {
  applyApiSecurityHeaders,
  readJsonBody,
  sendJson,
  VercelLikeRequest,
  VercelLikeResponse,
} from '../_lib/http.js';

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  applyApiSecurityHeaders(res);
  if (req.method !== 'POST') {
    return sendJson(res, 405, { success: false, error: 'Method not allowed' });
  }

  const start = Date.now();
  let authVerified = false;
  let voiceAvailable = false;

  try {
    const body = await readJsonBody(req);
    const sampleText =
      typeof body?.text === 'string' && body.text.trim()
        ? body.text.trim().slice(0, 200)
        : 'Guten Morgen! Willkommen bei Deutsch Meister.';
    const requestedVoiceId = typeof body?.voiceId === 'string' ? body.voiceId.trim() : '';
    const model =
      typeof body?.model === 'string' && body.model.trim()
        ? body.model.trim()
        : DEFAULT_ELEVENLABS_MODEL;

    let voicesReadRestricted = false;
    let targetVoiceId = requestedVoiceId;
    let targetVoiceName = 'Sarah';

    try {
      const voiceCatalog = await fetchElevenLabsVoicesServer();
      authVerified = true;

      targetVoiceId = requestedVoiceId || voiceCatalog.defaultFemaleVoiceId;
      const matchedVoice = voiceCatalog.voices.find((v) => v.voiceId === targetVoiceId);

      if (!matchedVoice) {
        throw new ElevenLabsServiceError({
          message: `الصوت المحدد (${targetVoiceId}) غير متاح ضمن أصوات حساب ElevenLabs الخاص بك. اختر صوتاً متاحاً أو أعد الضبط للافتراضي (${voiceCatalog.defaultFemaleVoiceId}).`,
          code: 'ELEVENLABS_INVALID_VOICE',
          errorType: 'voice_not_found',
          status: 400,
        });
      }
      targetVoiceName = matchedVoice.name;
      voiceAvailable = true;
    } catch (voiceErr) {
      if (!isMissingVoicesReadPermission(voiceErr)) {
        throw voiceErr;
      }
      voicesReadRestricted = true;
      const fallback = getFallbackVoicesSnapshot();
      targetVoiceId = requestedVoiceId || fallback.defaultFemaleVoiceId;
      const matchedFallback = fallback.voices.find((v) => v.voiceId === targetVoiceId);
      targetVoiceName = matchedFallback?.name || 'ElevenLabs Voice';
      voiceAvailable = true;
    }

    const synth = await synthesizeWithElevenLabsServer({
      text: sampleText,
      voiceId: targetVoiceId,
      model,
    });
    authVerified = true;

    const quota = await fetchElevenLabsQuotaSummary();

    return sendJson(res, 200, {
      success: true,
      data: {
        authVerified,
        voiceAvailable,
        audioGenerated: true,
        voicesReadRestricted,
        voiceId: targetVoiceId,
        voiceName: targetVoiceName,
        model: synth.model,
        outputFormat: synth.outputFormat,
        bytes: synth.buffer.length,
        contentType: synth.contentType,
        requestId: synth.requestId,
        latencyMs: Date.now() - start,
        quota,
        audioBase64: synth.buffer.toString('base64'),
      },
    });
  } catch (err: any) {
    const status =
      err instanceof ElevenLabsServiceError
        ? err.status
        : typeof err?.status === 'number'
        ? err.status
        : 500;
    console.error('[Vercel /api/elevenlabs/test] Error:', {
      status,
      code: err?.code,
      errorType: err?.errorType,
      upstreamStatus: err?.upstreamStatus,
      requestId: err?.requestId || null,
      stack: err?.stack,
    });
    return sendJson(res, status, {
      success: false,
      code: err?.code || 'ELEVENLABS_TEST_FAILED',
      errorType: err?.errorType || 'test_failed',
      upstreamStatus: err?.upstreamStatus ?? null,
      upstreamMessage: err?.upstreamMessage ?? null,
      requestId: err?.requestId ?? null,
      error: err?.message || 'فشل اختبار الاتصال والتوليد الصوتي عبر ElevenLabs.',
      data: {
        authVerified,
        voiceAvailable,
        audioGenerated: false,
        latencyMs: Date.now() - start,
      },
    });
  }
}
