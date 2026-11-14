/**
 * Audio MIME detection, filename preservation (Arabic/German/special chars),
 * and Supabase Storage bucket SQL configuration helpers.
 */

export const SUPPORTED_AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'm4a',
  'ogg',
  'webm',
  'aac',
  'flac',
] as const;

export const SUPPORTED_AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/x-m4a',
  'audio/ogg',
  'audio/webm',
  'audio/aac',
  'audio/flac',
  'audio/x-flac',
] as const;

export const BUCKET_ALLOWED_MIME_TYPES = [
  'text/plain',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/x-m4a',
  'audio/ogg',
  'audio/webm',
  'audio/aac',
  'audio/flac',
  'audio/x-flac',
  'application/octet-stream',
] as const;

export const SUPABASE_AUDIO_BUCKET_SQL = `-- Run in Supabase Dashboard -> SQL Editor (updates existing 'german-learning' bucket without duplicates)
update storage.buckets
set allowed_mime_types = array[
  'text/plain',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/x-m4a',
  'audio/ogg',
  'audio/webm',
  'audio/aac',
  'audio/flac',
  'audio/x-flac',
  'application/octet-stream'
]
where id = 'german-learning';`;

const MIME_BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  webm: 'audio/webm',
  aac: 'audio/aac',
  flac: 'audio/flac',
  txt: 'text/plain',
  csv: 'text/plain',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function getFileExtension(fileName?: string): string {
  if (!fileName) return '';
  const clean = fileName.split(/[?#]/)[0].trim();
  const dot = clean.lastIndexOf('.');
  if (dot <= 0 || dot === clean.length - 1) return '';
  return clean.slice(dot + 1).toLowerCase();
}

export function isAudioFileNameOrMime(fileName?: string, mimeType?: string): boolean {
  const ext = getFileExtension(fileName);
  if ((SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
    return true;
  }
  const baseMime = (mimeType || '').split(';')[0].trim().toLowerCase();
  return baseMime.startsWith('audio/');
}

export function normalizeAudioMimeType(rawMime?: string, fileName?: string): string {
  const base = (rawMime || '').split(';')[0].trim().toLowerCase();
  const ext = getFileExtension(fileName);

  if (base === 'audio/mp3' || base === 'audio/x-mpeg' || base === 'audio/mpeg3' || base === 'audio/x-mpeg-3') {
    return 'audio/mpeg';
  }
  if (base === 'audio/wave' || base === 'audio/vnd.wave') {
    return 'audio/wav';
  }
  if (base === 'audio/m4a' || base === 'audio/mp4a-latm') {
    return 'audio/mp4';
  }
  if (base === 'audio/x-m4a') {
    return ext === 'm4a' ? 'audio/mp4' : 'audio/x-m4a';
  }
  if (base === 'audio/x-wav') {
    return 'audio/x-wav';
  }
  if (base === 'audio/x-flac') {
    return 'audio/flac';
  }
  if ((SUPPORTED_AUDIO_MIME_TYPES as readonly string[]).includes(base)) {
    return base;
  }
  if (ext && MIME_BY_EXTENSION[ext]) {
    return MIME_BY_EXTENSION[ext];
  }
  if (base && base !== 'application/octet-stream') {
    return base;
  }
  return 'application/octet-stream';
}

function readAscii(bytes: Uint8Array, start: number, len: number): string {
  let out = '';
  for (let i = 0; i < len && start + i < bytes.length; i++) {
    out += String.fromCharCode(bytes[start + i]);
  }
  return out;
}

/**
 * Inspects file header magic bytes first, then extension and browser-reported type,
 * to reliably identify the true MIME type of audio and document files.
 */
export async function detectActualMimeType(blob: Blob, fileName?: string): Promise<string> {
  const ext = getFileExtension(fileName);
  const declared = (blob.type || '').split(';')[0].trim().toLowerCase();

  try {
    const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    if (head.length >= 4) {
      // MP3: ID3 tag or MPEG-1/2 Layer III frame sync (11 set bits + MPEG audio)
      if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
        return 'audio/mpeg';
      }
      if (head[0] === 0xff && (head[1] & 0xe6) === 0xe2) {
        return 'audio/mpeg';
      }
      // WAV: RIFF....WAVE
      if (head.length >= 12 && readAscii(head, 0, 4) === 'RIFF' && readAscii(head, 8, 4) === 'WAVE') {
        return 'audio/wav';
      }
      // M4A / MP4 audio: ....ftyp
      if (head.length >= 12 && readAscii(head, 4, 4) === 'ftyp') {
        const brand = readAscii(head, 8, 4).toLowerCase();
        if (brand.startsWith('m4a') || brand.startsWith('m4b') || brand.startsWith('mp4') || brand === 'isom' || brand === 'iso2') {
          return 'audio/mp4';
        }
      }
      // OGG: OggS
      if (readAscii(head, 0, 4) === 'OggS') {
        return 'audio/ogg';
      }
      // FLAC: fLaC
      if (readAscii(head, 0, 4) === 'fLaC') {
        return 'audio/flac';
      }
      // WEBM / Matroska: 0x1A 0x45 0xDF 0xA3
      if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
        return 'audio/webm';
      }
      // ADTS AAC: 0xFF 0xF0 / 0xF1 / 0xF8 / 0xF9 (12-bit syncword, layer == 00)
      if (head[0] === 0xff && (head[1] & 0xf6) === 0xf0) {
        return 'audio/aac';
      }
      // PDF: %PDF
      if (readAscii(head, 0, 4) === '%PDF') {
        return 'application/pdf';
      }
    }
  } catch {
    // Ignore slice read failures and fall back to extension / declared type
  }

  if (ext && MIME_BY_EXTENSION[ext]) {
    return MIME_BY_EXTENSION[ext];
  }

  return normalizeAudioMimeType(declared, fileName);
}

/**
 * Returns an alternate canonical audio MIME type if a bucket only registered one alias.
 */
export function getAlternateAudioMimeType(mimeType: string): string | null {
  switch (mimeType.toLowerCase()) {
    case 'audio/wav':
      return 'audio/x-wav';
    case 'audio/x-wav':
      return 'audio/wav';
    case 'audio/mp4':
      return 'audio/x-m4a';
    case 'audio/x-m4a':
      return 'audio/mp4';
    case 'audio/mpeg':
      return 'audio/mp3';
    case 'audio/mp3':
      return 'audio/mpeg';
    case 'audio/flac':
      return 'audio/x-flac';
    case 'audio/x-flac':
      return 'audio/flac';
    default:
      return null;
  }
}

/**
 * Preserves original filename & extension including Arabic, German (äöüß),
 * and safe punctuation, stripping only dangerous path/control characters.
 * Also builds an ASCII fallback filename for storage backends that enforce ASCII keys.
 */
export function preserveUploadFilename(fileName: string): {
  preservedName: string;
  asciiFallbackName: string;
  ext: string;
} {
  const raw = (fileName || 'audio.mp3').normalize('NFC').trim();
  const lastSlash = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
  const leaf = lastSlash >= 0 ? raw.slice(lastSlash + 1) : raw;

  const dot = leaf.lastIndexOf('.');
  const rawBase = dot > 0 ? leaf.slice(0, dot) : leaf;
  const rawExt = dot > 0 ? leaf.slice(dot + 1) : '';
  const cleanExt = rawExt.replace(/[^A-Za-z0-9]/g, '').toLowerCase().slice(0, 10);
  const extSuffix = cleanExt ? `.${cleanExt}` : '';

  // Keep Arabic, German, Unicode letters/numbers, spaces, hyphens, underscores, parentheses, dots
  const preservedBase =
    rawBase
      .replace(/[/\\?%*:|"<>#\x00-\x1f]/g, '_')
      .replace(/\.\.+/g, '.')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 120) || 'file';

  const transliterated = preservedBase
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  const asciiClean = transliterated
    .replace(/[^A-Za-z0-9._\-() ]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.\s]+|[_.\s]+$/g, '')
    .slice(0, 96);

  // Add short deterministic suffix if Unicode chars were collapsed so distinct Arabic names never collide
  let hash = 0;
  for (let i = 0; i < preservedBase.length; i++) {
    hash = ((hash << 5) - hash + preservedBase.charCodeAt(i)) | 0;
  }
  const shortTag = Math.abs(hash).toString(36).slice(0, 6);
  const needsTag = asciiClean !== transliterated || !asciiClean;
  const asciiBase = asciiClean
    ? needsTag
      ? `${asciiClean}_${shortTag}`
      : asciiClean
    : `file_${shortTag}`;

  return {
    preservedName: `${preservedBase}${extSuffix}`,
    asciiFallbackName: `${asciiBase}${extSuffix}`,
    ext: cleanExt,
  };
}
