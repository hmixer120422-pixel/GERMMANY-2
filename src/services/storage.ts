import {
  GermanTextPassage,
  ReadingSettings,
  SavedWord,
  ListeningStats,
  ReadingHistoryEntry,
} from '../types';
import {
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_FEMALE_VOICE_ID,
  VERIFIED_ELEVENLABS_VOICES,
} from './elevenLabsVoices';
import {
  clearReadingHistoryInSupabase,
  deletePassageFromSupabase,
  deleteWordFromSupabase,
  pushAllWordsToSupabase,
  pushPassageToSupabase,
  pushReadingHistoryToSupabase,
  pushUserSettingsToSupabase,
  pushWordToSupabase,
  syncAllWithSupabase,
} from './supabaseSync';

const SETTINGS_STORAGE_KEY = 'deutsch_meister_settings_v1';

// Legacy localStorage keys (migrated automatically into IndexedDB and cleared)
const LEGACY_KEYS = {
  TEXTS: 'deutsch_meister_texts_v1',
  ACTIVE_TEXT_ID: 'deutsch_meister_active_text_id',
  SAVED_WORDS: 'deutsch_meister_saved_words_v1',
  STATS: 'deutsch_meister_stats_v1',
};

const DATA_DB_NAME = 'DeutschMeisterBrowserDB';
const DATA_DB_VERSION = 1;
const STORES = {
  TEXTS: 'texts',
  VOCABULARY: 'vocabulary',
  HISTORY: 'readingHistory',
} as const;

export const DEFAULT_SETTINGS: ReadingSettings = {
  voice: 'Sarah (German Female)',
  voiceGender: 'female',
  elevenLabsVoiceId: DEFAULT_FEMALE_VOICE_ID,
  elevenLabsModel: DEFAULT_ELEVENLABS_MODEL,
  speed: 1.0,
  pitch: 0,
  defaultLevel: 'A2',
  readingMode: 'continuous',
  autoResumeAfterWord: false,
  autoScroll: true,
  sentencePauseMs: 350,
  paragraphPauseMs: 750,
  repeatMode: 'none',
  concentrationMode: false,
  timerMinutes: 0,
  theme: 'light',
};

export const INITIAL_TEXTS: GermanTextPassage[] = [
  {
    id: 'seed-a2-work',
    title: 'Mein Beruf und mein Team',
    authorInfo: 'Erman Akay, 30 Jahre, München',
    level: 'A2',
    germanText:
      '„Ich bin Kfz-Ingenieur. In meiner Firma arbeiten viele Menschen aus verschiedenen Ländern. Wir verstehen uns sehr gut und unterstützen uns gegenseitig. Für mich ist ein gutes Arbeitsklima besonders wichtig. Ich finde, dass jeder Mensch die gleichen Chancen bekommen sollte.“',
    sentences: [
      '„Ich bin Kfz-Ingenieur.',
      'In meiner Firma arbeiten viele Menschen aus verschiedenen Ländern.',
      'Wir verstehen uns sehr gut und unterstützen uns gegenseitig.',
      'Für mich ist ein gutes Arbeitsklima besonders wichtig.',
      'Ich finde, dass jeder Mensch die gleichen Chancen bekommen sollte.“',
    ],
    arabicSummary:
      'أنا مهندس سيارات. في شركتي يعمل الكثير من الأشخاص من مختلف البلدان. نحن نتفاهم جيداً وندعم بعضنا البعض. بالنسبة لي بيئة العمل الجيدة مهمة جداً. أعتقد أنه ينبغي أن يحصل كل إنسان على نفس الفرص.',
    keyVocabulary: [
      {
        german: 'das Arbeitsklima',
        arabic: 'بيئة العمل / مناخ العمل',
        pos: 'Nomen',
        article: 'das',
        pronunciationArabic: 'داس أربايتس كليما',
      },
      {
        german: 'unterstützen',
        arabic: 'يدعم / يساند',
        pos: 'Verb',
        pronunciationArabic: 'أونتر شتوتسن',
      },
      {
        german: 'die Chance',
        arabic: 'الفرصة',
        pos: 'Nomen',
        article: 'die',
        plural: 'die Chancen',
        pronunciationArabic: 'دي شانسيه',
      },
      {
        german: 'gegenseitig',
        arabic: 'متبادل / بعضنا بعضاً',
        pos: 'Adjektiv',
        pronunciationArabic: 'غايغنزايتيش',
      },
    ],
    wordCount: 42,
    style: 'Personal Story',
    topic: 'Arbeit und Beruf',
    createdAt: '2026-11-12T08:00:00.000Z',
    isFavorite: true,
  },
  {
    id: 'seed-b1-ausbildung',
    title: 'Ausbildung und Zukunftschancen',
    authorInfo: 'Sarah Lindemann, 24 Jahre, Hamburg',
    level: 'B1',
    germanText:
      '„Ich interessiere mich schon seit längerer Zeit für eine Ausbildung in Deutschland. Besonders wichtig ist mir, einen Beruf zu finden, der gute Zukunftsmöglichkeiten bietet. Deshalb informiere ich mich regelmäßig über verschiedene Ausbildungsberufe und deren Voraussetzungen. Außerdem möchte ich meine Deutschkenntnisse stetig verbessern, damit ich mich im Alltag und bei der Arbeit sicher verständigen kann.“',
    sentences: [
      '„Ich interessiere mich schon seit längerer Zeit für eine Ausbildung in Deutschland.',
      'Besonders wichtig ist mir, einen Beruf zu finden, der gute Zukunftsmöglichkeiten bietet.',
      'Deshalb informiere ich mich regelmäßig über verschiedene Ausbildungsberufe und deren Voraussetzungen.',
      'Außerdem möchte ich meine Deutschkenntnisse stetig verbessern, damit ich mich im Alltag und bei der Arbeit sicher verständigen kann.“',
    ],
    arabicSummary:
      'أنا مهتمة منذ فترة طويلة بالتدريب المهني في ألمانيا. من المهم جداً بالنسبة لي العثور على مهنة توفر فرصاً جيدة للمستقبل. لذلك أستعلم بانتظام عن مختلف المهن وشروطها. بالإضافة إلى ذلك أرغب في تحسين لغتي الألمانية باستمرار حتى أتمكن من التواصل بثقة في الحياة اليومية والعمل.',
    keyVocabulary: [
      {
        german: 'die Ausbildung',
        arabic: 'التدريب المهني',
        pos: 'Nomen',
        article: 'die',
        plural: 'die Ausbildungen',
        pronunciationArabic: 'دي أوسبيلدونغ',
      },
      {
        german: 'die Voraussetzung',
        arabic: 'الشرط / المتطلب',
        pos: 'Nomen',
        article: 'die',
        plural: 'die Voraussetzungen',
        pronunciationArabic: 'دي فور أوس زيتسونغ',
      },
      {
        german: 'sich verständigen',
        arabic: 'يتفاهم / يتواصل',
        pos: 'Verb',
        pronunciationArabic: 'زيش فيرشتنديغن',
      },
    ],
    wordCount: 56,
    style: 'Educational Passage',
    topic: 'Ausbildung in Deutschland',
    createdAt: '2026-11-11T14:30:00.000Z',
    isFavorite: false,
  },
  {
    id: 'seed-b2-digitalisierung',
    title: 'Künstliche Intelligenz und moderne Arbeitswelt',
    authorInfo: 'Dr. Jonas Becker, 38 Jahre, Frankfurt am Main',
    level: 'B2',
    germanText:
      '„Die Digitalisierung und der zunehmende Einsatz künstlicher Intelligenz transformieren nahezu sämtliche Wirtschaftszweige in rasantem Tempo. Während manche Beschäftigte den Verlust traditioneller Arbeitsplätze befürchten, betonen Experten vielmehr das Entstehen innovativer Tätigkeitsfelder. Entscheidend wird künftig sein, lebenslanges Lernen als selbstverständlichen Bestandteil der beruflichen Entwicklung zu begreifen.“',
    sentences: [
      '„Die Digitalisierung und der zunehmende Einsatz künstlicher Intelligenz transformieren nahezu sämtliche Wirtschaftszweige in rasantem Tempo.',
      'Während manche Beschäftigte den Verlust traditioneller Arbeitsplätze befürchten, betonen Experten vielmehr das Entstehen innovativer Tätigkeitsfelder.',
      'Entscheidend wird künftig sein, lebenslanges Lernen als selbstverständlichen Bestandteil der beruflichen Entwicklung zu begreifen.“',
    ],
    arabicSummary:
      'يؤدي التحول الرقمي والاستخدام المتزايد للذكاء الاصطناعي إلى تحول جميع القطاعات الاقتصادية تقريباً بوتيرة متسارعة. بينما يخشى بعض الموظفين فقدان الوظائف التقليدية، يؤكد الخبراء بدلاً من ذلك على ظهور مجالات عمل مبتكرة. سيكون من الحاسم في المستقبل اعتبار التعلم مدى الحياة جزءاً طبيعياً من التطور المهني.',
    keyVocabulary: [
      {
        german: 'die Digitalisierung',
        arabic: 'التحول الرقمي',
        pos: 'Nomen',
        article: 'die',
        pronunciationArabic: 'دي ديغيتاليزيرونغ',
      },
      {
        german: 'befürchten',
        arabic: 'يخشى / يتخوف',
        pos: 'Verb',
        pronunciationArabic: 'بي فورشتن',
      },
      {
        german: 'der Bestandteil',
        arabic: 'جزء لا يتجزأ / عنصر',
        pos: 'Nomen',
        article: 'der',
        plural: 'die Bestandteile',
        pronunciationArabic: 'دير بيشتاند تايل',
      },
    ],
    wordCount: 54,
    style: 'Opinion',
    topic: 'Künstliche Intelligenz',
    createdAt: '2026-11-10T11:15:00.000Z',
    isFavorite: false,
  },
];

export const INITIAL_SAVED_WORDS: SavedWord[] = [
  {
    id: 'word-1',
    germanWord: 'Ausbildung',
    article: 'die',
    plural: 'Ausbildungen',
    arabicMeaning: 'تدريب مهني / تأهيل عملي',
    ipa: '[ˈaʊ̯sˌbɪldʊŋ]',
    arabicPronunciation: 'أوسبيلدونغ',
    partOfSpeech: 'Nomen',
    exampleGerman: 'Ich mache eine Ausbildung zum Mechatroniker.',
    exampleArabic: 'أقوم بتدريب مهني في ميكاترونيك.',
    level: 'B1',
    dateSaved: '2026-11-11T12:00:00.000Z',
    sourceTitle: 'Ausbildung und Zukunftschancen',
    mastery: 'learning',
  },
  {
    id: 'word-2',
    germanWord: 'unterstützen',
    arabicMeaning: 'يساند / يدعم / يساعد',
    ipa: '[ʊntɐˈʃtʏtsn̩]',
    arabicPronunciation: 'أونتر شتوتسن',
    partOfSpeech: 'Verb',
    exampleGerman: 'Wir unterstützen uns bei der täglichen Arbeit.',
    exampleArabic: 'نحن نساند بعضنا في العمل اليومي.',
    level: 'A2',
    dateSaved: '2026-11-12T08:30:00.000Z',
    sourceTitle: 'Mein Beruf und mein Team',
    mastery: 'mastered',
  },
  {
    id: 'word-3',
    germanWord: 'Arbeitsklima',
    article: 'das',
    plural: 'Arbeitsklimata',
    arabicMeaning: 'جو العمل / بيئة العمل',
    ipa: '[ˈaʁbaɪ̯tsˌkliːma]',
    arabicPronunciation: 'أربايتس كليما',
    partOfSpeech: 'Nomen',
    exampleGerman: 'Ein gutes Arbeitsklima motiviert alle Mitarbeiter.',
    exampleArabic: 'بيئة العمل الجيدة تحفز جميع الموظفين.',
    level: 'A2',
    dateSaved: '2026-11-12T09:00:00.000Z',
    sourceTitle: 'Mein Beruf und mein Team',
    mastery: 'review',
  },
];

const INITIAL_STATS: ListeningStats = {
  totalMinutesListened: 0,
  sentencesRead: 0,
  wordsLookedUp: 0,
  textsCompleted: 0,
};

// In-memory hydrated mirrors backed by IndexedDB
let textsCache: GermanTextPassage[] = [...INITIAL_TEXTS];
let wordsCache: SavedWord[] = [...INITIAL_SAVED_WORDS];
let activeTextIdCache: string = INITIAL_TEXTS[0].id;
let statsCache: ListeningStats = { ...INITIAL_STATS };
let historyCache: ReadingHistoryEntry[] = [];
let dbPromise: Promise<IDBDatabase> | null = null;
let initializedPromise: Promise<void> | null = null;

function isIndexedDbSupported(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openDataDb(): Promise<IDBDatabase> {
  if (!isIndexedDbSupported()) {
    return Promise.reject(new Error('IndexedDB is not supported in this browser.'));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DATA_DB_NAME, DATA_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.TEXTS)) {
        db.createObjectStore(STORES.TEXTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.VOCABULARY)) {
        db.createObjectStore(STORES.VOCABULARY, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.HISTORY)) {
        db.createObjectStore(STORES.HISTORY, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error || new Error('Failed to open IndexedDB storage.'));
    };
  });

  return dbPromise;
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDataDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as T[]) || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbReplaceAll<T>(storeName: string, items: T[]): Promise<void> {
  const db = await openDataDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
  });
}

async function idbPutRecord(storeName: string, record: any): Promise<void> {
  const db = await openDataDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Hydrates texts, vocabulary, and reading history from IndexedDB,
 * migrating any legacy localStorage payloads into IndexedDB and cleaning up old keys.
 */
export async function initBrowserStorage(): Promise<void> {
  if (initializedPromise) return initializedPromise;

  initializedPromise = (async () => {
    if (!isIndexedDbSupported()) return;

    try {
      const [dbTexts, dbWords, dbHistoryRecords] = await Promise.all([
        idbGetAll<GermanTextPassage>(STORES.TEXTS),
        idbGetAll<SavedWord>(STORES.VOCABULARY),
        idbGetAll<{ key: string; value: any }>(STORES.HISTORY),
      ]);

      // Migrate legacy localStorage data if IndexedDB is empty
      const legacyTextsRaw = localStorage.getItem(LEGACY_KEYS.TEXTS);
      const legacyWordsRaw = localStorage.getItem(LEGACY_KEYS.SAVED_WORDS);
      const legacyActiveId = localStorage.getItem(LEGACY_KEYS.ACTIVE_TEXT_ID);
      const legacyStatsRaw = localStorage.getItem(LEGACY_KEYS.STATS);

      if (dbTexts.length > 0) {
        textsCache = dbTexts.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      } else if (legacyTextsRaw) {
        try {
          const parsed = JSON.parse(legacyTextsRaw);
          textsCache = Array.isArray(parsed) && parsed.length > 0 ? parsed : [...INITIAL_TEXTS];
        } catch {
          textsCache = [...INITIAL_TEXTS];
        }
        await idbReplaceAll(STORES.TEXTS, textsCache);
      } else {
        textsCache = [...INITIAL_TEXTS];
        await idbReplaceAll(STORES.TEXTS, textsCache);
      }

      if (dbWords.length > 0) {
        wordsCache = dbWords.sort(
          (a, b) => new Date(b.dateSaved).getTime() - new Date(a.dateSaved).getTime()
        );
      } else if (legacyWordsRaw) {
        try {
          const parsed = JSON.parse(legacyWordsRaw);
          wordsCache = Array.isArray(parsed) ? parsed : [...INITIAL_SAVED_WORDS];
        } catch {
          wordsCache = [...INITIAL_SAVED_WORDS];
        }
        await idbReplaceAll(STORES.VOCABULARY, wordsCache);
      } else {
        wordsCache = [...INITIAL_SAVED_WORDS];
        await idbReplaceAll(STORES.VOCABULARY, wordsCache);
      }

      const historyMap = new Map(dbHistoryRecords.map((r) => [r.key, r.value]));

      const storedActiveId = historyMap.get('activeTextId') || legacyActiveId;
      activeTextIdCache =
        typeof storedActiveId === 'string' && storedActiveId
          ? storedActiveId
          : textsCache[0]?.id || INITIAL_TEXTS[0].id;
      await idbPutRecord(STORES.HISTORY, { key: 'activeTextId', value: activeTextIdCache });

      if (historyMap.has('stats')) {
        statsCache = { ...INITIAL_STATS, ...historyMap.get('stats') };
      } else if (legacyStatsRaw) {
        try {
          statsCache = { ...INITIAL_STATS, ...JSON.parse(legacyStatsRaw) };
        } catch {
          statsCache = { ...INITIAL_STATS };
        }
        await idbPutRecord(STORES.HISTORY, { key: 'stats', value: statsCache });
      } else {
        statsCache = { ...INITIAL_STATS };
        await idbPutRecord(STORES.HISTORY, { key: 'stats', value: statsCache });
      }

      historyCache = dbHistoryRecords
        .filter((r) => r.key.startsWith('passage:'))
        .map((r) => r.value as ReadingHistoryEntry)
        .sort((a, b) => new Date(b.lastReadAt).getTime() - new Date(a.lastReadAt).getTime());

      // Remove legacy localStorage keys so localStorage is reserved exclusively for settings/preferences
      localStorage.removeItem(LEGACY_KEYS.TEXTS);
      localStorage.removeItem(LEGACY_KEYS.SAVED_WORDS);
      localStorage.removeItem(LEGACY_KEYS.ACTIVE_TEXT_ID);
      localStorage.removeItem(LEGACY_KEYS.STATS);
    } catch (err) {
      console.error('Error initializing IndexedDB browser storage:', err);
    }
  })();

  return initializedPromise;
}

export function getStoredTexts(): GermanTextPassage[] {
  return [...textsCache];
}

export function saveStoredTexts(texts: GermanTextPassage[]): void {
  textsCache = [...texts];
  if (isIndexedDbSupported()) {
    idbReplaceAll(STORES.TEXTS, textsCache).catch((e) =>
      console.error('Error saving texts to IndexedDB', e)
    );
  }
}

export function addTextPassage(passage: GermanTextPassage): void {
  const stamped: GermanTextPassage = {
    ...passage,
    updatedAt: passage.updatedAt || new Date().toISOString(),
  };
  const texts = [...textsCache];
  const exists = texts.findIndex((t) => t.id === stamped.id);
  if (exists >= 0) {
    texts[exists] = stamped;
  } else {
    texts.unshift(stamped);
  }
  saveStoredTexts(texts);
  setActiveTextId(stamped.id);
  void pushPassageToSupabase(stamped);
}

export function updateTextPassage(passage: GermanTextPassage): void {
  const stamped: GermanTextPassage = {
    ...passage,
    updatedAt: new Date().toISOString(),
  };
  const texts = textsCache.map((t) => (t.id === stamped.id ? stamped : t));
  saveStoredTexts(texts);
  void pushPassageToSupabase(stamped);
}

export function deleteTextPassage(passageId: string): void {
  const target = textsCache.find((t) => t.id === passageId);
  const updated = textsCache.filter((t) => t.id !== passageId);
  saveStoredTexts(updated);
  historyCache = historyCache.filter((h) => h.textId !== passageId);
  void deletePassageFromSupabase(passageId, target?.storagePath);
}

export function getActiveTextId(): string {
  return activeTextIdCache || textsCache[0]?.id || INITIAL_TEXTS[0].id;
}

export function setActiveTextId(id: string): void {
  activeTextIdCache = id;
  if (isIndexedDbSupported()) {
    idbPutRecord(STORES.HISTORY, { key: 'activeTextId', value: id }).catch((e) =>
      console.error('Error saving activeTextId to IndexedDB', e)
    );
  }
  void pushUserSettingsToSupabase({
    settings: getStoredSettings(),
    stats: statsCache,
    activeTextId: id,
  });
}

export function recordReadingHistoryProgress(
  passage: GermanTextPassage,
  sentenceIndex: number
): void {
  const entry: ReadingHistoryEntry = {
    textId: passage.id,
    title: passage.title,
    level: passage.level,
    lastSentenceIndex: sentenceIndex,
    totalSentences: passage.sentences.length,
    lastReadAt: new Date().toISOString(),
  };

  const idx = historyCache.findIndex((h) => h.textId === passage.id);
  if (idx >= 0) {
    historyCache[idx] = entry;
  } else {
    historyCache.unshift(entry);
  }

  // Also keep lastReadSentenceIndex synchronized inside saved texts store
  const textIdx = textsCache.findIndex((t) => t.id === passage.id);
  if (textIdx >= 0 && textsCache[textIdx].lastReadSentenceIndex !== sentenceIndex) {
    textsCache[textIdx] = {
      ...textsCache[textIdx],
      lastReadSentenceIndex: sentenceIndex,
      updatedAt: new Date().toISOString(),
    };
    if (isIndexedDbSupported()) {
      idbPutRecord(STORES.TEXTS, textsCache[textIdx]).catch(() => {});
    }
  }

  if (isIndexedDbSupported()) {
    idbPutRecord(STORES.HISTORY, { key: `passage:${passage.id}`, value: entry }).catch(() => {});
  }

  void pushReadingHistoryToSupabase(entry);
}

export function getReadingHistoryEntries(): ReadingHistoryEntry[] {
  return [...historyCache];
}

export function getStoredSavedWords(): SavedWord[] {
  return [...wordsCache];
}

export function saveStoredWords(words: SavedWord[]): void {
  wordsCache = [...words];
  if (isIndexedDbSupported()) {
    idbReplaceAll(STORES.VOCABULARY, wordsCache).catch((e) =>
      console.error('Error saving vocabulary to IndexedDB', e)
    );
  }
  void pushAllWordsToSupabase(wordsCache);
}

export function addSavedWord(word: Omit<SavedWord, 'id' | 'dateSaved'>): SavedWord {
  const words = [...wordsCache];
  const existingIdx = words.findIndex(
    (w) => w.germanWord.toLowerCase() === word.germanWord.toLowerCase()
  );

  const newWord: SavedWord = {
    ...word,
    id: existingIdx >= 0 ? words[existingIdx].id : 'word-' + Date.now(),
    dateSaved: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    words[existingIdx] = newWord;
  } else {
    words.unshift(newWord);
  }

  wordsCache = [...words];
  if (isIndexedDbSupported()) {
    idbReplaceAll(STORES.VOCABULARY, wordsCache).catch((e) =>
      console.error('Error saving vocabulary to IndexedDB', e)
    );
  }
  void pushWordToSupabase(newWord);
  updateStats({ wordsLookedUp: 1 });
  return newWord;
}

export function removeSavedWord(id: string): void {
  wordsCache = wordsCache.filter((w) => w.id !== id);
  if (isIndexedDbSupported()) {
    idbReplaceAll(STORES.VOCABULARY, wordsCache).catch((e) =>
      console.error('Error saving vocabulary to IndexedDB', e)
    );
  }
  void deleteWordFromSupabase(id);
}

// Application settings & user preferences remain stored in localStorage (and synced to Supabase when signed in)
export function getStoredSettings(): ReadingSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(raw);
    const merged: ReadingSettings = { ...DEFAULT_SETTINGS, ...parsed };
    const isVerifiedVoice = VERIFIED_ELEVENLABS_VOICES.some(
      (v) => v.voiceId === merged.elevenLabsVoiceId
    );
    // Never allow legacy Browser voice mode or deprecated library-only voice IDs
    if (!merged.voice || merged.voice === 'Browser' || !merged.elevenLabsVoiceId || !isVerifiedVoice) {
      merged.voice = DEFAULT_SETTINGS.voice;
      merged.voiceGender = DEFAULT_SETTINGS.voiceGender;
      merged.elevenLabsVoiceId = DEFAULT_SETTINGS.elevenLabsVoiceId;
      merged.elevenLabsModel = DEFAULT_SETTINGS.elevenLabsModel;
    }
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveStoredSettings(settings: ReadingSettings, syncToCloud = true): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    if (syncToCloud) {
      void pushUserSettingsToSupabase({
        settings,
        stats: statsCache,
        activeTextId: activeTextIdCache,
      });
    }
  } catch (e) {
    console.error('Error saving settings', e);
  }
}

export function getStoredStats(): ListeningStats {
  return { ...statsCache };
}

export function updateStats(delta: Partial<ListeningStats>): void {
  statsCache = {
    totalMinutesListened: statsCache.totalMinutesListened + (delta.totalMinutesListened || 0),
    sentencesRead: statsCache.sentencesRead + (delta.sentencesRead || 0),
    wordsLookedUp: statsCache.wordsLookedUp + (delta.wordsLookedUp || 0),
    textsCompleted: statsCache.textsCompleted + (delta.textsCompleted || 0),
  };
  if (isIndexedDbSupported()) {
    idbPutRecord(STORES.HISTORY, { key: 'stats', value: statsCache }).catch((e) =>
      console.error('Error updating stats in IndexedDB', e)
    );
  }
  void pushUserSettingsToSupabase({
    settings: getStoredSettings(),
    stats: statsCache,
    activeTextId: activeTextIdCache,
  });
}

export async function getBrowserDataSummary(): Promise<{
  textsCount: number;
  vocabularyCount: number;
  historyCount: number;
}> {
  await initBrowserStorage();
  return {
    textsCount: textsCache.length,
    vocabularyCount: wordsCache.length,
    historyCount: historyCache.length,
  };
}

export async function clearReadingHistoryInIndexedDb(): Promise<void> {
  historyCache = [];
  statsCache = { ...INITIAL_STATS };
  if (isIndexedDbSupported()) {
    await idbReplaceAll(STORES.HISTORY, [
      { key: 'activeTextId', value: getActiveTextId() },
      { key: 'stats', value: statsCache },
    ]);
  }
  void clearReadingHistoryInSupabase();
}

/**
 * Hydrates and merges local IndexedDB/localStorage with Supabase cloud data after user login.
 */
export async function hydrateFromSupabase(): Promise<boolean> {
  await initBrowserStorage();
  const merged = await syncAllWithSupabase({
    texts: textsCache,
    words: wordsCache,
    history: historyCache,
    settings: getStoredSettings(),
    stats: statsCache,
    activeTextId: getActiveTextId(),
  });

  if (!merged) return false;

  textsCache = merged.texts;
  wordsCache = merged.words;
  historyCache = merged.history;
  statsCache = merged.stats;
  activeTextIdCache = merged.activeTextId;

  saveStoredSettings(merged.settings, false);
  if (isIndexedDbSupported()) {
    await Promise.all([
      idbReplaceAll(STORES.TEXTS, textsCache),
      idbReplaceAll(STORES.VOCABULARY, wordsCache),
      idbReplaceAll(STORES.HISTORY, [
        { key: 'activeTextId', value: activeTextIdCache },
        { key: 'stats', value: statsCache },
        ...historyCache.map((h) => ({ key: `passage:${h.textId}`, value: h })),
      ]),
    ]);
  }

  return true;
}

export function exportWordsToCSV(words: SavedWord[]): void {
  const headers = [
    'الكلمة الألمانية',
    'الأداة',
    'الجمع',
    'المعنى بالعربية',
    'النطق بالعربية',
    'IPA',
    'نوع الكلمة',
    'المستوى',
    'مثال بالألماني',
    'ترجمة المثال',
  ];
  const rows = words.map((w) => [
    `"${w.germanWord}"`,
    `"${w.article || ''}"`,
    `"${w.plural || ''}"`,
    `"${w.arabicMeaning.replace(/"/g, '""')}"`,
    `"${w.arabicPronunciation || ''}"`,
    `"${w.ipa || ''}"`,
    `"${w.partOfSpeech || ''}"`,
    `"${w.level}"`,
    `"${(w.exampleGerman || '').replace(/"/g, '""')}"`,
    `"${(w.exampleArabic || '').replace(/"/g, '""')}"`,
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `deutsch_meister_vocabulary_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
