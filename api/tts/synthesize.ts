import {
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_FEMALE_VOICE_ID,
} from '../../src/services/elevenLabsVoices';
import { normalizeGermanText } from '../../src/utils/audioHash';
import { synthesizeWithElevenLabsServer } from '../_lib/elevenlabs';
import {
  applyApiSecurityHeaders,
  readJsonBody,
  sendBinary,
  sendJson,
  VercelLikeRequest,
  VercelLikeResponse,
} from '../_lib/http';

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  applyApiSecurityHeaders(res);
  if (req.method !== 'POST') {
    return sendJson(res, 405, { success: false, error: 'Method not allowed' });
  }

  try {
    const body = await readJsonBody(req);
    const {
      text,
      model = DEFAULT_ELEVENLABS_MODEL,
      voiceId = DEFAULT_FEMALE_VOICE_ID,
    } = body || {};

    if (typeof text !== 'string' || !text.trim()) {
      return sendJson(res, 400, {
        success: false,
        code: 'INVALID_TEXT',
        error: 'النص مطلوب لتوليد الصوت عبر ElevenLabs.',
      });
    }

    const normalizedText = normalizeGermanText(text);
    if (normalizedText.length > 3500) {
      return sendJson(res, 400, {
        success: false,
        code: 'TEXT_TOO_LONG',
        error: 'يتجاوز المقطع النصي الحد الأقصى البالغ 3,500 حرف.',
      });
    }

    const synth = await synthesizeWithElevenLabsServer({
      text: normalizedText,
      voiceId:
        typeof voiceId === 'string' && voiceId.trim()
          ? voiceId.trim()
          : DEFAULT_FEMALE_VOICE_ID,
      model:
        typeof model === 'string' && model.trim()
          ? model.trim()
          : DEFAULT_ELEVENLABS_MODEL,
    });

    return sendBinary(res, 200, 'audio/mpeg', synth.buffer, {
      'X-Audio-Source': 'Newly Generated ElevenLabs Audio',
    });
  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : 500;
    return sendJson(res, status, {
      success: false,
      code: err?.code || 'TTS_SYNTHESIS_FAILED',
      error: err?.message || 'تعذر توليد الصوت عبر ElevenLabs.',
    });
  }
}
