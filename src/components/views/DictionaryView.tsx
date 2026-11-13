import React, { useState } from 'react';
import {
  BookOpen,
  Search,
  Volume2,
  Bookmark,
  Check,
  Sparkles,
  ArrowRight,
  Info,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import { WordExplanation, CEFRLevel } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { addSavedWord, getStoredSavedWords } from '../../services/storage';

interface DictionaryViewProps {
  selectedLevel: CEFRLevel;
  onRefreshWords: () => void;
}

export const DictionaryView: React.FC<DictionaryViewProps> = ({
  selectedLevel,
  onRefreshWords,
}) => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WordExplanation | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [lastSpokenText, setLastSpokenText] = useState<string>('');

  const popularWords = [
    'Ausbildung',
    'Arbeitsklima',
    'verstehen',
    'unterstützen',
    'Möglichkeit',
    'Erfahrung',
    'zuverlässig',
    'entwickeln',
    'entscheidend',
    'nachhaltig',
  ];

  const handleSearch = async (wordToSearch: string) => {
    const clean = wordToSearch.trim();
    if (!clean) return;

    setLoading(true);
    setError(null);
    setIsSaved(false);

    try {
      const res = await fetch('/api/dictionary/explain-word', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word: clean,
          sentence: '',
          level: selectedLevel,
        }),
      });

      const rawText = await res.text();
      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        const { analyzeGermanWordLocally } = await import('../../data/germanDictionary');
        data = { success: true, data: analyzeGermanWordLocally(clean) };
      }

      if (data && data.success && data.data) {
        setResult(data.data);
      } else {
        const { analyzeGermanWordLocally } = await import('../../data/germanDictionary');
        setResult(analyzeGermanWordLocally(clean));
      }

      const savedWords = getStoredSavedWords();
      setIsSaved(savedWords.some((w) => w.germanWord.toLowerCase() === clean.toLowerCase()));
    } catch (err: any) {
      console.warn('Dictionary search fallback:', err);
      try {
        const { analyzeGermanWordLocally } = await import('../../data/germanDictionary');
        setResult(analyzeGermanWordLocally(clean));
      } catch {
        setError(err.message || 'خطأ في جلب بيانات المعجم');
      }
    } finally {
      setLoading(false);
    }
  };

  const pronounceText = async (textToSpeak: string) => {
    if (!textToSpeak) return;
    setAudioError(null);
    setLastSpokenText(textToSpeak);
    setIsPlaying(true);
    const ok = await audioEngine.playWordOnly(textToSpeak);
    setIsPlaying(false);
    if (!ok) {
      setAudioError(audioEngine.getLastError() || 'تعذر توليد الصوت عبر ElevenLabs.');
    }
  };

  const handlePronounce = () => {
    if (!result?.word) return;
    pronounceText(result.word);
  };

  const handleSave = () => {
    if (!result) return;
    addSavedWord({
      germanWord: result.word,
      article: result.nounInfo?.article,
      plural: result.nounInfo?.plural,
      arabicMeaning: result.contextMeaningArabic,
      ipa: result.ipa,
      arabicPronunciation: result.pronunciationArabic,
      partOfSpeech: result.partOfSpeech,
      exampleGerman: result.exampleGerman,
      exampleArabic: result.exampleArabic,
      level: selectedLevel,
      sourceTitle: 'قاموس الكلمات',
      mastery: 'learning',
    });
    setIsSaved(true);
    onRefreshWords();
  };

  const getArticleColor = (article?: string) => {
    if (!article) return '';
    const l = article.toLowerCase().trim();
    if (l === 'der') return 'text-blue-600 bg-blue-50 dark:bg-blue-900/40 border-blue-200';
    if (l === 'die') return 'text-rose-600 bg-rose-50 dark:bg-rose-900/40 border-rose-200';
    if (l === 'das') return 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/40 border-emerald-200';
    return 'text-slate-600 bg-slate-50 border-slate-200';
  };

  return (
    <div className="space-y-8 animate-in fade-in" dir="rtl">
      {/* Header */}
      <div className="pb-4 border-b border-slate-200/80 dark:border-slate-800">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-xs font-bold mb-1">
          <BookOpen className="w-3.5 h-3.5" />
          <span>المعجم الألماني التفاعلي الشامل</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
          قاموس وتحليل المفردات الألمانية
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          ابحث عن أي كلمة ألمانية لتحصل على أداتها وصيغ الجمع وتصريفات الأفعال وأمثلة واقعية مع النطق الصوتي الفوري.
        </p>
      </div>

      {/* Search Input Box */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSearch(query);
          }}
          className="relative"
        >
          <Search className="w-5 h-5 text-slate-400 absolute right-4 top-4" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="اكتب أي كلمة ألمانية (مثال: Ausbildung, Haus, gehen, schön...)"
            className="w-full pr-12 pl-28 py-3.5 text-base font-german bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            dir="ltr"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="absolute left-2 top-2 bottom-2 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-bold transition-all flex items-center gap-1.5"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <span>بحث وتحليل</span>
            )}
          </button>
        </form>

        {/* Popular Word Chips */}
        <div className="flex items-center gap-1.5 flex-wrap pt-1">
          <span className="text-xs text-slate-400 font-medium ml-1">كلمات شائعة:</span>
          {popularWords.map((pw) => (
            <button
              key={pw}
              onClick={() => {
                setQuery(pw);
                handleSearch(pw);
              }}
              className="px-2.5 py-1 text-xs rounded-lg font-german bg-slate-100 hover:bg-blue-50 hover:text-blue-700 dark:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
              dir="ltr"
            >
              {pw}
            </button>
          ))}
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div className="p-4 bg-rose-50 text-rose-700 rounded-2xl text-sm border border-rose-200">
          {error}
        </div>
      )}

      {audioError && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 rounded-2xl text-xs border border-rose-200 dark:border-rose-900/60 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="truncate font-semibold">{audioError}</span>
          </div>
          <button
            type="button"
            onClick={() => pronounceText(lastSpokenText || result?.word || '')}
            className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && !result && (
        <div className="py-16 text-center space-y-3 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800">
          <div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
            جارٍ تحليل الكلمة وقواعدها وتصريفاتها...
          </p>
        </div>
      )}

      {/* Result Card */}
      {result && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 sm:p-8 space-y-6 shadow-sm animate-in fade-in">
          {/* Main word banner */}
          <div className="flex flex-wrap items-start justify-between gap-4 pb-6 border-b border-slate-100 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                {result.nounInfo?.article && (
                  <span className={`px-2.5 py-1 text-xs font-bold rounded-lg border ${getArticleColor(result.nounInfo.article)}`}>
                    {result.nounInfo.article}
                  </span>
                )}
                <h2 className="font-german text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-wide" dir="ltr">
                  {result.word}
                </h2>
                <span className="px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold">
                  {result.partOfSpeech}
                </span>
              </div>

              <div className="mt-2.5 flex items-center gap-3 text-sm flex-wrap">
                <span className="text-blue-700 dark:text-blue-400 font-bold">
                  النطق بالعربية: {result.pronunciationArabic}
                </span>
                <span className="font-mono text-xs text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded" dir="ltr">
                  {result.ipa}
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={handlePronounce}
                className={`p-3 rounded-2xl transition-all shadow-xs flex items-center gap-2 text-xs font-bold ${
                  isPlaying
                    ? 'bg-blue-600 text-white'
                    : 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 hover:bg-blue-100'
                }`}
                title="استمع للنطق بالصوت النسائي"
              >
                <Volume2 className="w-5 h-5" />
                <span>نطق الكلمة</span>
              </button>

              <button
                onClick={handleSave}
                className={`p-3 rounded-2xl transition-all shadow-xs flex items-center gap-2 text-xs font-bold ${
                  isSaved
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200'
                }`}
                title="حفظ إلى مفرداتي"
              >
                {isSaved ? <Check className="w-5 h-5" /> : <Bookmark className="w-5 h-5" />}
                <span>{isSaved ? 'محفوظة' : 'حفظ الكلمة'}</span>
              </button>
            </div>
          </div>

          {/* Meaning Block */}
          <div className="p-5 rounded-2xl bg-blue-50/50 dark:bg-slate-800/40 border border-blue-100 dark:border-slate-700 space-y-1">
            <span className="text-xs font-bold text-blue-700 dark:text-blue-400 block">
              المعنى الأساسي بالعربية:
            </span>
            <p className="text-2xl font-black text-slate-900 dark:text-white font-arabic">
              {result.contextMeaningArabic}
            </p>
            {result.otherMeaningsArabic && result.otherMeaningsArabic.length > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                معانٍ أخرى: {result.otherMeaningsArabic.join(' • ')}
              </p>
            )}
          </div>

          {/* Grammatical Detail: Nouns */}
          {result.nounInfo && (
            <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3">
              <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-blue-500" />
                بيانات الاسم في الألمانية:
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-100 dark:border-slate-700">
                  <span className="text-xs text-slate-400 block mb-0.5">المفرد مع الأداة:</span>
                  <span className="font-german font-bold text-slate-900 dark:text-white" dir="ltr">
                    {result.nounInfo.article} {result.nounInfo.singular || result.word}
                  </span>
                </div>
                <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-100 dark:border-slate-700">
                  <span className="text-xs text-slate-400 block mb-0.5">صيغة الجمع:</span>
                  <span className="font-german font-bold text-slate-900 dark:text-white" dir="ltr">
                    {result.nounInfo.plural || '—'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Grammatical Detail: Verbs */}
          {result.verbInfo && (
            <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3">
              <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-blue-500" />
                تصريف الفعل في الأزمنة الأساسية:
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="bg-white dark:bg-slate-800 p-2.5 rounded-xl border border-slate-100 dark:border-slate-750">
                  <span className="text-slate-400 block mb-0.5">Infinitiv:</span>
                  <span className="font-german font-bold text-slate-900 dark:text-white" dir="ltr">
                    {result.verbInfo.infinitiv}
                  </span>
                </div>
                <div className="bg-white dark:bg-slate-800 p-2.5 rounded-xl border border-slate-100 dark:border-slate-750">
                  <span className="text-slate-400 block mb-0.5">Präsens (er/sie):</span>
                  <span className="font-german font-bold text-slate-900 dark:text-white" dir="ltr">
                    {result.verbInfo.praesens}
                  </span>
                </div>
                <div className="bg-white dark:bg-slate-800 p-2.5 rounded-xl border border-slate-100 dark:border-slate-750">
                  <span className="text-slate-400 block mb-0.5">Präteritum:</span>
                  <span className="font-german font-bold text-slate-900 dark:text-white" dir="ltr">
                    {result.verbInfo.praeteritum}
                  </span>
                </div>
                <div className="bg-white dark:bg-slate-800 p-2.5 rounded-xl border border-slate-100 dark:border-slate-750">
                  <span className="text-slate-400 block mb-0.5">Perfekt:</span>
                  <span className="font-german font-bold text-slate-900 dark:text-white" dir="ltr">
                    {result.verbInfo.perfekt}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Example sentence */}
          {result.exampleGerman && (
            <div className="p-5 rounded-2xl bg-indigo-50/40 dark:bg-slate-800/40 border border-indigo-100 dark:border-slate-700 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-700 dark:text-indigo-400 block">
                  مثال توضيحي للاستخدام:
                </span>
                <button
                  type="button"
                  onClick={() => pronounceText(result.exampleGerman)}
                  className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 transition-colors flex items-center gap-1 text-[11px] font-bold"
                  title="استمع لنطق المثال"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>نطق المثال</span>
                </button>
              </div>
              <p className="font-german text-base font-semibold text-slate-900 dark:text-slate-100 leading-relaxed" dir="ltr">
                {result.exampleGerman}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-arabic">
                {result.exampleArabic}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
