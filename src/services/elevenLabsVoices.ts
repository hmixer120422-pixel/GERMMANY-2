import { ElevenLabsVoiceOption } from '../types';

export const DEFAULT_ELEVENLABS_MODEL = 'eleven_multilingual_v2';
export const DEFAULT_ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';
export const DEFAULT_FEMALE_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // Sarah (Natural German Hochdeutsch Female)
export const DEFAULT_MALE_VOICE_ID = 'ErXwobaYiN019PkySvjV'; // Antoni (Multilingual v2)

/**
 * Curated ElevenLabs Multilingual v2 voices for German (Hochdeutsch) reading & listening.
 */
export const VERIFIED_ELEVENLABS_VOICES: ElevenLabsVoiceOption[] = [
  {
    voiceId: 'EXAVITQu4vr4xnSDxMaL',
    name: 'Sarah (German Female)',
    labelArabic: 'Sarah (صوت نسائي ألماني طبيعي — Hochdeutsch)',
    gender: 'female',
    description: 'نطق ألماني فصيح وواضح ومتزن (eleven_multilingual_v2)',
    model: DEFAULT_ELEVENLABS_MODEL,
    isDefaultFemale: true,
  },
  {
    voiceId: 'Xb7hH8MSUJpSbSDYk0k2',
    name: 'Alice (Clear Female)',
    labelArabic: 'Alice (صوت نسائي نقي وواضح)',
    gender: 'female',
    description: 'نبرة واضحة لنصوص القراءة الطويلة والمفردات',
    model: DEFAULT_ELEVENLABS_MODEL,
  },
  {
    voiceId: 'FGY2WhTYpPnrIDTdsKH5',
    name: 'Laura (Warm Female)',
    labelArabic: 'Laura (صوت نسائي دافئ ومعبّر)',
    gender: 'female',
    description: 'مناسب للقصص الشخصية والحوارات اليومية',
    model: DEFAULT_ELEVENLABS_MODEL,
  },
  {
    voiceId: 'ErXwobaYiN019PkySvjV',
    name: 'Antoni (Clear Male)',
    labelArabic: 'Antoni (صوت ذكوري واضح وهادئ)',
    gender: 'male',
    description: 'مناسب للحوارات والمقالات الرسمية',
    model: DEFAULT_ELEVENLABS_MODEL,
  },
  {
    voiceId: 'pNInz6obpgDQGcFmaJgB',
    name: 'Adam (Deep Male)',
    labelArabic: 'Adam (صوت ذكوري عميق ورصين)',
    gender: 'male',
    description: 'مثالي للنصوص الإخبارية والمستويات B2–C2',
    model: DEFAULT_ELEVENLABS_MODEL,
  },
  {
    voiceId: 'onwK4e9ZLuTAKqWW03F9',
    name: 'Daniel (Broadcast Male)',
    labelArabic: 'Daniel (صوت ذكوري إخباري متزن)',
    gender: 'male',
    description: 'مناسب للمقالات التحليلية والتقارير',
    model: DEFAULT_ELEVENLABS_MODEL,
  },
];

