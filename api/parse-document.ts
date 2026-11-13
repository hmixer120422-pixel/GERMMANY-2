import mammoth from 'mammoth';
import { splitGermanSentences } from '../src/utils/audioHash';
import {
  applyApiSecurityHeaders,
  readJsonBody,
  sendJson,
  VercelLikeRequest,
  VercelLikeResponse,
} from './_lib/http';

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  applyApiSecurityHeaders(res);
  if (req.method !== 'POST') {
    return sendJson(res, 405, { success: false, error: 'Method not allowed' });
  }

  try {
    const body = await readJsonBody(req);
    const { fileName, fileContentBase64, fileType } = body || {};

    if (!fileContentBase64 || typeof fileContentBase64 !== 'string') {
      return sendJson(res, 400, { success: false, error: 'File content is required' });
    }

    const buffer = Buffer.from(fileContentBase64, 'base64');
    let extractedText = '';

    if (fileType === 'docx' || (fileName && fileName.endsWith('.docx'))) {
      const result = await mammoth.extractRawText({ buffer });
      extractedText = result.value;
    } else if (fileType === 'txt' || (fileName && fileName.endsWith('.txt'))) {
      extractedText = buffer.toString('utf-8');
    } else if (fileType === 'pdf' || (fileName && fileName.endsWith('.pdf'))) {
      const rawStr = buffer.toString('utf-8');
      const textMatches = rawStr.match(/\((.*?)\)\s*Tj/g) || rawStr.match(/\[(.*?)\]\s*TJ/g);
      if (textMatches && textMatches.length > 0) {
        extractedText = textMatches
          .map((m) => m.replace(/^[(\[]|[)\]]\s*T[jJ]$/g, ''))
          .join(' ')
          .replace(/\\([()\\])/g, '$1');
      } else {
        extractedText = buffer.toString('utf-8').replace(/[^\x20-\x7E\xC0-\xFF\n\r\t]/g, ' ');
      }
    } else {
      extractedText = buffer.toString('utf-8');
    }

    const cleanedText = extractedText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim();

    const sentences = splitGermanSentences(cleanedText);

    return sendJson(res, 200, {
      success: true,
      data: {
        text: cleanedText,
        sentences,
        sentenceCount: sentences.length,
        wordCount: cleanedText.split(/\s+/).filter(Boolean).length,
      },
    });
  } catch (error: any) {
    console.error('Error parsing document:', error?.message || error);
    return sendJson(res, 500, { success: false, error: error?.message || 'Document parse error' });
  }
}
