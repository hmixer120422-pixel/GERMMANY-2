import { ElevenLabsVoiceOption } from '../types';
import {
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
  DEFAULT_FEMALE_VOICE_ID,
  DEFAULT_MALE_VOICE_ID,
  VERIFIED_ELEVENLABS_VOICES,
} from './elevenLabsConstants.js';

export {
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
  DEFAULT_FEMALE_VOICE_ID,
  DEFAULT_MALE_VOICE_ID,
  VERIFIED_ELEVENLABS_VOICES,
};

export interface LiveElevenLabsVoicesSnapshot {
  voices: ElevenLabsVoiceOption[];
  defaultFemaleVoiceId: string;
  defaultMaleVoiceId: string;
  elevenLabsConfigured: boolean;
  source: 'elevenlabs-live' | 'fallback';
  error: string | null;
}

let cachedSnapshot: LiveElevenLabsVoicesSnapshot = {
  voices: VERIFIED_ELEVENLABS_VOICES,
  defaultFemaleVoiceId: DEFAULT_FEMALE_VOICE_ID,
  defaultMaleVoiceId: DEFAULT_MALE_VOICE_ID,
  elevenLabsConfigured: false,
  source: 'fallback',
  error: null,
};

const listeners = new Set<(snapshot: LiveElevenLabsVoicesSnapshot) => void>();

export function getAvailableElevenLabsVoices(): LiveElevenLabsVoicesSnapshot {
  return cachedSnapshot;
}

export function onElevenLabsVoicesChange(
  cb: (snapshot: LiveElevenLabsVoicesSnapshot) => void
): () => void {
  listeners.add(cb);
  cb(cachedSnapshot);
  return () => listeners.delete(cb);
}

export async function fetchAvailableElevenLabsVoices(): Promise<LiveElevenLabsVoicesSnapshot> {
  try {
    const res = await fetch('/api/elevenlabs/voices', { cache: 'no-store' });
    const json: any = await res.json().catch(() => null);
    const payload = json?.data;

    if (payload && Array.isArray(payload.voices) && payload.voices.length > 0) {
      cachedSnapshot = {
        voices: payload.voices,
        defaultFemaleVoiceId: payload.defaultFemaleVoiceId || payload.voices[0].voiceId,
        defaultMaleVoiceId: payload.defaultMaleVoiceId || payload.voices[0].voiceId,
        elevenLabsConfigured: Boolean(payload.elevenLabsConfigured),
        source: payload.source === 'elevenlabs-live' ? 'elevenlabs-live' : 'fallback',
        error: json?.success === false ? json?.error || 'تعذر جلب الأصوات من ElevenLabs.' : null,
      };
    } else if (json?.error) {
      cachedSnapshot = {
        ...cachedSnapshot,
        error: json.error,
      };
    }
  } catch (err: any) {
    cachedSnapshot = {
      ...cachedSnapshot,
      error: err?.message || 'تعذر الاتصال بالخادم لجلب أصوات ElevenLabs.',
    };
  }

  listeners.forEach((cb) => cb(cachedSnapshot));
  return cachedSnapshot;
}
