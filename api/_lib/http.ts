import type { IncomingMessage, ServerResponse } from 'http';

export interface VercelLikeRequest extends IncomingMessage {
  body?: any;
  query?: Record<string, string | string[]>;
}

export interface VercelLikeResponse extends ServerResponse {
  status?: (code: number) => VercelLikeResponse;
  json?: (payload: any) => void;
  send?: (body: any) => void;
}

export function applyApiSecurityHeaders(res: VercelLikeResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Cache-Control', 'no-store');
}

export function sendJson(res: VercelLikeResponse, statusCode: number, payload: any): void {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    const statusRes = res.status(statusCode);
    if (typeof statusRes?.json === 'function') {
      statusRes.json(payload);
      return;
    }
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function sendBinary(
  res: VercelLikeResponse,
  statusCode: number,
  contentType: string,
  buffer: Buffer,
  extraHeaders?: Record<string, string>
): void {
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      res.setHeader(k, v);
    }
  }
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(buffer.length));
  if (typeof res.status === 'function' && typeof res.send === 'function') {
    const statusRes = res.status(statusCode);
    if (typeof statusRes?.send === 'function') {
      statusRes.send(buffer);
      return;
    }
  }
  res.statusCode = statusCode;
  res.end(buffer);
}

export async function readJsonBody(req: VercelLikeRequest): Promise<any> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body);
      } catch {
        return {};
      }
    }
    return req.body;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
