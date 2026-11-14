import { DEFAULT_ELEVENLABS_MODEL } from '../../src/services/elevenLabsConstants.js';
import {
  ElevenLabsServiceError,
  fetchElevenLabsQuotaSummary,
  fetchElevenLabsVoicesServer,
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
        : 'Hallo! Willkommen bei Deutsch Meister.';
    const requestedVoiceId = typeof body?.voiceId === 'string' ? body.voiceId.trim() : '';
    const model =
      typeof body?.model === 'string' && body.model.trim()
        ? body.model.trim()
        : DEFAULT_ELEVENLABS_MODEL;

    // Step 1 & 2: Verify API authentication and retrieve live voices from ElevenLabs
    const voiceCatalog = await fetchElevenLabsVoicesServer();
    authVerified = true;

    const targetVoiceId = requestedVoiceId || voiceCatalog.defaultFemaleVoiceId;
    const matchedVoice = voiceCatalog.voices.find((v) => v.voiceId === targetVoiceId);

    if (!matchedVoice) {
      throw new ElevenLabsServiceError(
        `الصوت المحدد (${targetVoiceId}) غير متاح ضمن أصوات حساب ElevenLabs الخاص بك. اختر صوتاً متاحاً أو أعد الضبط للافتراضي (${voiceCatalog.defaultFemaleVoiceId}).`,
        'ELEVENLABS_INVALID_VOICE',
        400
      );
    }
    voiceAvailable = true;

    // Step 3: Verify actual MP3 audio generation via POST /v1/text-to-speech/{voice_id}
    const synth = await synthesizeWithElevenLabsServer({
      text: sampleText,
      voiceId: matchedVoice.voiceId,
      model,
    });

    const quota = await fetchElevenLabsQuotaSummary();

    return sendJson(res, 200, {
      success: true,
      data: {
        authVerified,
        voiceAvailable,
        audioGenerated: true,
        voiceId: matchedVoice.voiceId,
        voiceName: matchedVoice.name,
        model: synth.model,
        bytes: synth.buffer.length,
        contentType: synth.contentType,
        latencyMs: Date.now() - start,
        quota,
        audioBase64: synth.buffer.toString('base64'),
      },
    });
  } catch (err: any) {
    const status = err instanceof ElevenLabsServiceError ? err.status : typeof err?.status === 'number' ? err.status : 500;
    return sendJson(res, status, {
      success: false,
      code: err?.code || 'ELEVENLABS_TEST_FAILED',
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
