import { DEFAULT_ELEVENLABS_MODEL } from '../../src/services/elevenLabsConstants.js';
import {
  ElevenLabsServiceError,
  fetchElevenLabsVoicesServer,
  getElevenLabsApiKey,
  getFallbackVoicesSnapshot,
} from '../_lib/elevenlabs.js';
import {
  applyApiSecurityHeaders,
  sendJson,
  VercelLikeRequest,
  VercelLikeResponse,
} from '../_lib/http.js';

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  applyApiSecurityHeaders(res);
  if (req.method && req.method !== 'GET') {
    return sendJson(res, 405, { success: false, error: 'Method not allowed' });
  }

  const configured = Boolean(getElevenLabsApiKey());
  if (!configured) {
    const fallback = getFallbackVoicesSnapshot();
    return sendJson(res, 200, {
      success: true,
      data: {
        provider: 'elevenlabs',
        model: DEFAULT_ELEVENLABS_MODEL,
        elevenLabsConfigured: false,
        source: 'fallback',
        defaultFemaleVoiceId: fallback.defaultFemaleVoiceId,
        defaultMaleVoiceId: fallback.defaultMaleVoiceId,
        voices: fallback.voices,
      },
    });
  }

  try {
    const live = await fetchElevenLabsVoicesServer();
    return sendJson(res, 200, {
      success: true,
      data: {
        provider: 'elevenlabs',
        model: DEFAULT_ELEVENLABS_MODEL,
        elevenLabsConfigured: true,
        source: live.source,
        defaultFemaleVoiceId: live.defaultFemaleVoiceId,
        defaultMaleVoiceId: live.defaultMaleVoiceId,
        voices: live.voices,
      },
    });
  } catch (err: any) {
    const fallback = getFallbackVoicesSnapshot();
    const status = err instanceof ElevenLabsServiceError ? err.status : 502;
    return sendJson(res, status, {
      success: false,
      code: err?.code || 'ELEVENLABS_VOICES_FETCH_FAILED',
      error: err?.message || 'تعذر جلب قائمة الأصوات من ElevenLabs.',
      data: {
        provider: 'elevenlabs',
        model: DEFAULT_ELEVENLABS_MODEL,
        elevenLabsConfigured: true,
        source: 'fallback',
        defaultFemaleVoiceId: fallback.defaultFemaleVoiceId,
        defaultMaleVoiceId: fallback.defaultMaleVoiceId,
        voices: fallback.voices,
      },
    });
  }
}
