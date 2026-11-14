/**
 * Decodes the bytes of a German .txt file. Tries UTF-8 first and falls back to Windows-1252
 * (what Notepad & older tools save), so umlauts and ß are not turned into "�". Strips a BOM.
 */
export function decodeGermanTextBuffer(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  return text.replace(/^\uFEFF/, '');
}

export interface AudioHashParams {
  text: string;
  language?: string;
  provider?: string;
  model?: string;
  voiceId: string;
  audioFormat?: string;
  cacheVersion?: number;
}

/**
 * Normalizes German text using Unicode NFC while preserving capitalization,
 * umlauts (ä, ö, ü, Ä, Ö, Ü), Eszett (ß), and pronunciation-relevant punctuation.
 */
export function normalizeGermanText(text: string): string {
  return text
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Computes a deterministic 64-char SHA-256 hex digest using Web Crypto API
 * (supported natively in modern browsers and Node.js 20+).
 * Intentionally excludes playback-only speed (playbackRate) so changing speed
 * reuses the exact same cached MP3 file.
 */
export async function computeAudioHash(params: AudioHashParams): Promise<{
  audioHash: string;
  normalizedText: string;
  payloadString: string;
}> {
  const normalizedText = normalizeGermanText(params.text);
  const payload = {
    text: normalizedText,
    language: params.language || 'de-DE',
    provider: params.provider || 'elevenlabs',
    model: params.model || 'eleven_multilingual_v2',
    voiceId: params.voiceId,
    format: params.audioFormat || 'mp3',
    version: params.cacheVersion ?? 1,
  };
  const payloadString = JSON.stringify(payload);
  const encoded = new TextEncoder().encode(payloadString);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const audioHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  return {
    audioHash,
    normalizedText,
    payloadString,
  };
}

/**
 * Splits German reading text into individual sentences while preserving
 * punctuation and protecting common German abbreviations and decimal numbers.
 */
export function splitGermanSentences(text: string): string[] {
  if (!text || !text.trim()) return [];

  const protectedText = text
    .replace(
      /(z\.B\.|d\.h\.|bzw\.|u\.a\.|usw\.|ca\.|Dr\.|Prof\.|Hr\.|Fr\.|Nr\.|Std\.|Min\.|Abs\.|vgl\.|evtl\.|inkl\.|ggf\.|str\.)/gi,
      (match) => match.replace(/\./g, '__DOT__')
    )
    .replace(/(\d+)\.(\d+)/g, '$1__DOT__$2');

  const rawParts = protectedText.split(/([.!?]+["»”„]?\s+|\n+)/g);
  const sentences: string[] = [];
  let current = '';

  for (let i = 0; i < rawParts.length; i++) {
    const part = rawParts[i];
    if (!part) continue;

    if (part.includes('\n')) {
      if (current.trim()) {
        sentences.push(current.replace(/__DOT__/g, '.').trim());
        current = '';
      }
    } else if (/[.!?]/.test(part)) {
      current += part;
      if (current.trim()) {
        sentences.push(current.replace(/__DOT__/g, '.').trim());
        current = '';
      }
    } else {
      current += part;
    }
  }

  if (current.trim()) {
    sentences.push(current.replace(/__DOT__/g, '.').trim());
  }

  return sentences.filter((s) => s.length > 0);
}

/**
 * Splits long German passages into sentence-aligned chunks <= maxChars (default 2,800)
 * for reliable ElevenLabs synthesis and high cache hit granularity.
 */
export function splitTextIntoTtsChunks(text: string, maxChars = 2800): string[] {
  const normalized = normalizeGermanText(text);
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  // Protect common German abbreviations before splitting sentences
  const protectedStr = normalized
    .replace(
      /(z\.B\.|d\.h\.|bzw\.|u\.a\.|usw\.|ca\.|Dr\.|Prof\.|Hr\.|Fr\.|Nr\.|Std\.|Min\.|Abs\.|vgl\.|evtl\.|inkl\.|ggf\.|str\.)/gi,
      (m) => m.replace(/\./g, '__DOT__')
    )
    .replace(/(\d+)\.(\d+)/g, '$1__DOT__$2');

  const rawSentences = protectedStr
    .split(/(?<=[.!?]["»”„]?)\s+/g)
    .map((s) => s.replace(/__DOT__/g, '.').trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  for (const sentence of rawSentences) {
    if (sentence.length > maxChars) {
      if (current) {
        chunks.push(current.trim());
        current = '';
      }
      // Hard word-boundary split for unusually huge single sentences
      const words = sentence.split(' ');
      let subChunk = '';
      for (const word of words) {
        if ((subChunk + ' ' + word).trim().length > maxChars) {
          if (subChunk) chunks.push(subChunk.trim());
          subChunk = word;
        } else {
          subChunk = (subChunk + ' ' + word).trim();
        }
      }
      if (subChunk) chunks.push(subChunk.trim());
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxChars) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, idx);
  return `${val.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

function getAudioExtensionFromMime(mimeType?: string): string {
  const lower = (mimeType || '').toLowerCase();
  if (lower.includes('wav')) return 'wav';
  if (lower.includes('mp4') || lower.includes('m4a')) return 'm4a';
  if (lower.includes('aac')) return 'aac';
  if (lower.includes('flac')) return 'flac';
  if (lower.includes('ogg')) return 'ogg';
  if (lower.includes('webm')) return 'webm';
  return 'mp3';
}

/**
 * Generates a readable, storage-safe audio filename directly from the spoken text
 * (transliterating German umlauts/ß so S3/Supabase keys remain clean and legible).
 */
export function buildAudioFileNameFromText(
  text: string,
  mimeType?: string,
  fallbackId?: string
): string {
  const ext = getAudioExtensionFromMime(mimeType);
  const transliterated = (text || '')
    .trim()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  let base = transliterated
    .replace(/[^A-Za-z0-9\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');

  if (base.length > 96) {
    base = base.slice(0, 96).replace(/[_-]+$/g, '');
  }

  if (!base) {
    base = `audio_${(fallbackId || Date.now().toString()).slice(0, 8)}`;
  }

  return `${base}.${ext}`;
}

export function dedupeAudioFileName(fileName: string, usedNames: Set<string>): string {
  const key = fileName.toLowerCase();
  if (!usedNames.has(key)) {
    usedNames.add(key);
    return fileName;
  }

  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';

  let counter = 2;
  while (usedNames.has(`${base}_${counter}${ext}`.toLowerCase())) {
    counter += 1;
  }
  const uniqueName = `${base}_${counter}${ext}`;
  usedNames.add(uniqueName.toLowerCase());
  return uniqueName;
}

