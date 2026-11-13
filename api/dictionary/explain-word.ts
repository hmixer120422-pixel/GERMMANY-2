import {
  COMMON_GERMAN_DICTIONARY,
  analyzeGermanWordLocally,
} from '../../src/data/germanDictionary';
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
  const { word, sentence = '' } = body || {};
  if (!word || typeof word !== 'string' || !word.trim()) {
    return sendJson(res, 400, { success: false, error: 'Word is required' });
  }

  const cleanWord = word.trim().replace(/[.,!?;:„"“»«()]/g, '');
  const lower = cleanWord.toLowerCase();

  if (COMMON_GERMAN_DICTIONARY[lower]) {
    return sendJson(res, 200, { success: true, data: COMMON_GERMAN_DICTIONARY[lower] });
  }

  const data = analyzeGermanWordLocally(cleanWord, String(sentence));
  return sendJson(res, 200, { success: true, data });
}
