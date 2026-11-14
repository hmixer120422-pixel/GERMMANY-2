/**
 * Decodes multiple word audio Blobs (MP3, WAV, M4A, OGG, WEBM, AAC, FLAC) via Web Audio API,
 * normalizes sample rates, trims excessive edge silence, applies micro-fades to prevent clicks,
 * and stitches them sequentially into one continuous sentence audio Blob.
 */

function trimAudioEdges(
  buffer: AudioBuffer,
  threshold = 0.0035,
  leadingPadSec = 0.012,
  trailingPadSec = 0.022
): { startSample: number; endSample: number } {
  const len = buffer.length;
  if (len <= Math.floor(buffer.sampleRate * 0.08)) {
    return { startSample: 0, endSample: len };
  }

  let firstActive = 0;
  outerStart: for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      if (Math.abs(buffer.getChannelData(ch)[i]) >= threshold) {
        firstActive = i;
        break outerStart;
      }
    }
  }

  let lastActive = len - 1;
  outerEnd: for (let i = len - 1; i >= firstActive; i--) {
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      if (Math.abs(buffer.getChannelData(ch)[i]) >= threshold) {
        lastActive = i;
        break outerEnd;
      }
    }
  }

  const startSample = Math.max(0, firstActive - Math.floor(buffer.sampleRate * leadingPadSec));
  const endSample = Math.min(len, lastActive + Math.floor(buffer.sampleRate * trailingPadSec));

  if (endSample <= startSample) {
    return { startSample: 0, endSample: len };
  }
  return { startSample, endSample };
}

function extractMonoResampledSegment(
  buffer: AudioBuffer,
  startSample: number,
  endSample: number,
  targetSampleRate: number
): Float32Array {
  const srcLen = endSample - startSample;
  const channels = buffer.numberOfChannels;

  // Mix down to mono Float32 first
  const mono = new Float32Array(srcLen);
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < srcLen; i++) {
      mono[i] += data[startSample + i] / channels;
    }
  }

  let output: Float32Array;
  if (buffer.sampleRate === targetSampleRate) {
    output = mono;
  } else {
    const ratio = buffer.sampleRate / targetSampleRate;
    const targetLen = Math.max(1, Math.round(srcLen / ratio));
    output = new Float32Array(targetLen);
    for (let i = 0; i < targetLen; i++) {
      const srcPos = i * ratio;
      const idx0 = Math.floor(srcPos);
      const idx1 = Math.min(idx0 + 1, srcLen - 1);
      const frac = srcPos - idx0;
      output[i] = mono[idx0] * (1 - frac) + mono[idx1] * frac;
    }
  }

  // Apply 4ms fade-in / fade-out to avoid boundary clicks
  const fadeSamples = Math.min(Math.floor(targetSampleRate * 0.004), Math.floor(output.length / 4));
  for (let i = 0; i < fadeSamples; i++) {
    const gain = i / fadeSamples;
    output[i] *= gain;
    output[output.length - 1 - i] *= gain;
  }

  return output;
}

function encodeMonoFloat32ToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Stitches an ordered list of word audio Blobs into one continuous sentence audio Blob.
 * Returns null if Web Audio decoding is unsupported or fails so callers can fall back safely.
 */
export async function stitchWordBlobsIntoSentence(
  blobs: Blob[],
  wordGapMs = 60
): Promise<Blob | null> {
  if (!blobs || blobs.length === 0) return null;
  if (blobs.length === 1) return blobs[0];
  if (typeof window === 'undefined') return null;

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  const ctx = new AudioCtx();
  try {
    const decodedBuffers: AudioBuffer[] = [];
    for (const blob of blobs) {
      const arrayBuf = await blob.arrayBuffer();
      // decodeAudioData requires a fresh buffer copy in some browsers
      const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
      decodedBuffers.push(decoded);
    }

    if (decodedBuffers.length === 0) return null;
    const targetSampleRate = decodedBuffers[0].sampleRate || 44100;
    const gapSamples = Math.max(0, Math.round((wordGapMs / 1000) * targetSampleRate));

    const segments: Float32Array[] = [];
    let totalSamples = 0;

    for (let i = 0; i < decodedBuffers.length; i++) {
      const buf = decodedBuffers[i];
      const { startSample, endSample } = trimAudioEdges(buf);
      const seg = extractMonoResampledSegment(buf, startSample, endSample, targetSampleRate);
      segments.push(seg);
      totalSamples += seg.length;
      if (i < decodedBuffers.length - 1) {
        totalSamples += gapSamples;
      }
    }

    const combined = new Float32Array(totalSamples);
    let cursor = 0;
    for (let i = 0; i < segments.length; i++) {
      combined.set(segments[i], cursor);
      cursor += segments[i].length;
      if (i < segments.length - 1) {
        cursor += gapSamples; // Already zeroed (silence)
      }
    }

    return encodeMonoFloat32ToWavBlob(combined, targetSampleRate);
  } catch (err) {
    console.warn('[AudioStitcher] Falling back because word stitching failed:', err);
    return null;
  } finally {
    await ctx.close().catch(() => {});
  }
}
