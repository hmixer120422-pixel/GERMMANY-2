import { analyzeGermanSentenceLocally } from '../../src/data/germanDictionary';
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

  const body = await readJsonBody(req);
  const { sentence } = body || {};
  if (!sentence || typeof sentence !== 'string' || !sentence.trim()) {
    return sendJson(res, 400, { success: false, error: 'Sentence is required' });
  }

  const data = analyzeGermanSentenceLocally(sentence.trim());
  return sendJson(res, 200, { success: true, data });
}
