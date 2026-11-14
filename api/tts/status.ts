import {
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_FEMALE_VOICE_ID,
  DEFAULT_MALE_VOICE_ID,
} from '../../src/services/elevenLabsConstants.js';
import { getElevenLabsApiKey } from '../_lib/elevenlabs.js';
import {
  applyApiSecurityHeaders,
  sendJson,
  VercelLikeRequest,
  VercelLikeResponse,
} from '../_lib/http.js';

export default function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  applyApiSecurityHeaders(res);
  if (req.method && req.method !== 'GET') {
    return sendJson(res, 405, { success: false, error: 'Method not allowed' });
  }

  return sendJson(res, 200, {
    success: true,
    data: {
      provider: 'elevenlabs',
      elevenLabsConfigured: Boolean(getElevenLabsApiKey()),
      model: DEFAULT_ELEVENLABS_MODEL,
      defaultFemaleVoiceId: DEFAULT_FEMALE_VOICE_ID,
      defaultMaleVoiceId: DEFAULT_MALE_VOICE_ID,
    },
  });
}
