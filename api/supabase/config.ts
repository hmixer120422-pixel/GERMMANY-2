import {
  applyApiSecurityHeaders,
  sendJson,
  VercelLikeRequest,
  VercelLikeResponse,
} from '../_lib/http';
import { getSupabasePublicConfig } from '../_lib/supabaseConfig';

export default function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  applyApiSecurityHeaders(res);
  if (req.method && req.method !== 'GET') {
    return sendJson(res, 405, { success: false, error: 'Method not allowed' });
  }

  return sendJson(res, 200, {
    success: true,
    data: getSupabasePublicConfig(),
  });
}
