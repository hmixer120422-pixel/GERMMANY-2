import {
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_FEMALE_VOICE_ID,
} from '../../src/services/elevenLabsVoices';
import { synthesizeWithElevenLabsServer } from '../_lib/elevenlabs';
import {
  applyApiSecurityHeaders,
  readJsonBody,
  sendJson,
  VercelLikeRequest,
  VercelLikeResponse,
} from '../_lib/http';

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  applyApiSecurityHeaders(res);
  if (req.method !== 'POST') {
    return sendJson(res, 405, { success: false, error: 'Method not allowed' });
  }

  const start = Date.now();
  try {
    const body = await readJsonBody(req);
    const sampleText =
      typeof body?.text === 'string' && body.text.trim()
        ? body.text.trim().slice(0, 200)
        : 'Hallo! Willkommen bei Deutsch Meister.';
    const voiceId =
      typeof body?.voiceId === 'string' && body.voiceId.trim()
        ? body.voiceId.trim()
        : DEFAULT_FEMALE_VOICE_ID;
    const model =
      typeof body?.model === 'string' && body.model.trim()
        ? body.model.trim()
        : DEFAULT_ELEVENLABS_MODEL;

    const synth = await synthesizeWithElevenLabsServer({
      text: sampleText,
      voiceId,
      model,
    });

    return sendJson(res, 200, {
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
    return sendJson(res, status, {
      success: false,
      code: err?.code || 'ELEVENLABS_TEST_FAILED',
      error: err?.message || 'فشل اختبار التوليد الصوتي عبر ElevenLabs.',
    });
  }
}
