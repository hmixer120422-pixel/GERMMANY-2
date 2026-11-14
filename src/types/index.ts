export type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export type TextStyle =
  | 'Educational Passage'
  | 'Personal Story'
  | 'Daily Life'
  | 'Dialogue'
  | 'Interview'
  | 'Newspaper Article'
  | 'Opinion'
  | 'Discussion'
  | 'Short Story'
  | 'Informative Text'
  | 'Experience Report'
  | 'Professional Conversation'
  | 'Email'
  | 'Formal Letter'
  | 'Blog Post';

export interface KeyVocabItem {
  german: string;
  arabic: string;
  pos: string;
  article?: string;
  plural?: string;
  pronunciationArabic?: string;
}

export interface GermanTextPassage {
  id: string;
  title: string;
  authorInfo: string;
  level: CEFRLevel;
  germanText: string;
  sentences: string[];
  arabicSummary: string;
  keyVocabulary: KeyVocabItem[];
  wordCount: number;
  style: string;
  topic: string;
  createdAt: string;
  lastReadSentenceIndex?: number;
  isFavorite?: boolean;
  storagePath?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  updatedAt?: string;
}

export interface WordExplanation {
  word: string;
  lemma: string;
  partOfSpeech: string;
  contextMeaningArabic: string;
  otherMeaningsArabic?: string[];
  pronunciationArabic: string;
  ipa: string;
  nounInfo?: {
    article?: string;
    singular?: string;
    plural?: string;
  };
  verbInfo?: {
    infinitiv?: string;
    praesens?: string;
    praeteritum?: string;
    perfekt?: string;
    auxiliary?: string;
    isSeparable?: boolean;
  };
  adjectiveInfo?: {
    base?: string;
    comparative?: string;
    superlative?: string;
  };
  exampleGerman: string;
  exampleArabic: string;
}

export interface SentenceExplanation {
  germanSentence: string;
  arabicTranslation: string;
  grammarNotes: string;
  keyWords: {
    german: string;
    arabic: string;
    article?: string;
  }[];
}

export interface SavedWord {
  id: string;
  germanWord: string;
  article?: string;
  plural?: string;
  arabicMeaning: string;
  ipa?: string;
  arabicPronunciation?: string;
  partOfSpeech?: string;
  exampleGerman?: string;
  exampleArabic?: string;
  level: CEFRLevel;
  dateSaved: string;
  sourceTitle?: string;
  mastery: 'learning' | 'mastered' | 'review';
}

export type VoiceGender = 'female' | 'male';

export type AudioSourceStatus =
  | 'Local Cached Audio'
  | 'Supabase Cloud Audio'
  | 'Newly Generated ElevenLabs Audio';

export interface ElevenLabsVoiceOption {
  voiceId: string;
  name: string;
  labelArabic: string;
  gender: VoiceGender;
  description: string;
  model: string;
  isDefaultFemale?: boolean;
}

export interface ReadingSettings {
  voice: string;
  voiceGender?: VoiceGender;
  elevenLabsVoiceId?: string;
  elevenLabsModel?: string;
  speed: number;
  pitch: number;
  defaultLevel: CEFRLevel;
  readingMode: 'continuous' | 'sentence-step';
  readingUnit?: 'sentence' | 'word';
  autoResumeAfterWord: boolean;
  autoScroll: boolean;
  sentencePauseMs: number;
  paragraphPauseMs: number;
  repeatMode: 'none' | 'sentence' | 'all';
  concentrationMode: boolean;
  timerMinutes: number;
  theme: 'light' | 'dark';
}

export interface ListeningStats {
  totalMinutesListened: number;
  sentencesRead: number;
  wordsLookedUp: number;
  textsCompleted: number;
}

export interface ReadingHistoryEntry {
  textId: string;
  title: string;
  level: CEFRLevel;
  lastSentenceIndex: number;
  totalSentences: number;
  lastReadAt: string;
}

export interface SupabaseStorageFileItem {
  name: string;
  path: string;
  id?: string;
  size: number;
  mimeType?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type SupabaseSyncState = 'idle' | 'syncing' | 'synced' | 'error' | 'offline';

