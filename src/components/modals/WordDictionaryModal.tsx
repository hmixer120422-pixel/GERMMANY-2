import React, { useState, useEffect } from 'react';
import { Volume2, Bookmark, Check, X, Sparkles, BookOpen, AlertCircle, RotateCcw } from 'lucide-react';
import { WordExplanation, CEFRLevel } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { addSavedWord, getStoredSavedWords } from '../../services/storage';

interface WordDictionaryModalProps {
  word: string;
  sentenceContext: string;
  level: CEFRLevel;
  sourceTitle?: string;
  isOpen: boolean;
  onClose: () => void;
}

export const WordDictionaryModal: React.FC<WordDictionaryModalProps> = ({
  word,
  sentenceContext,
  level,
  sourceTitle,
  isOpen,
  onClose,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<WordExplanation | null>(null);
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !word) return;

    const cleanWord = word.trim().replace(/[.,!?;:„"“»«()]/g, '');
    if (!cleanWord) {
      onClose();
      return;
    }

    // Check if word is already saved in storage
    const savedWords = getStoredSavedWords();
    const found = savedWords.some((w) => w.germanWord.toLowerCase() === cleanWord.toLowerCase());
    setIsSaved(found);

    // Check instant offline dictionary first, otherwise fetch live online dictionary via server
    let isCancelled = false;
    setError(null);
    setAudioError(null);

    import('../../data/germanDictionary')
      .then(({ lookupDictionaryEntry, analyzeGermanWordLocally }) => {
        if (isCancelled) return;
        const offlineHit = lookupDictionaryEntry(cleanWord);
        if (offlineHit) {
          setData(offlineHit);
          setLoading(false);
          return;
        }

        setLoading(true);
        fetch('/api/dictionary/explain-word', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            word: cleanWord,
            sentence: sentenceContext,
            level,
          }),
        })
          .then(async (res) => {
            const rawText = await res.text();
            try {
              return JSON.parse(rawText);
            } catch {
              return { success: false, error: 'استجابة غير صالحة' };
            }
          })
          .then((resData) => {
            if (isCancelled) return;
            if (resData.success && resData.data) {
              setData(resData.data);
            } else {
              setData(analyzeGermanWordLocally(cleanWord, sentenceContext));
            }
          })
          .catch(() => {
            if (isCancelled) return;
            setData(analyzeGermanWordLocally(cleanWord, sentenceContext));
          })
          .finally(() => {
            if (!isCancelled) setLoading(false);
          });
      })
      .catch((err) => {
        if (!isCancelled) {
          setLoading(false);
          setError(err?.message || 'تعذر تحميل بيانات القاموس');
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, word, sentenceContext, level, onClose]);

  if (!isOpen || !word) return null;

  const cleanWord = word.trim().replace(/[.,!?;:„"“»«()]/g, '');

  const handlePronounce = async () => {
    setAudioError(null);
    setIsPlayingAudio(true);
    const ok = await audioEngine.playWordOnly(cleanWord);
    setIsPlayingAudio(false);
    if (!ok) {
      setAudioError(audioEngine.getLastError() || 'تعذر توليد النطق عبر ElevenLabs.');
    }
  };

  const handleSave = () => {
    if (!data) return;
    addSavedWord({
      germanWord: data.word || cleanWord,
      article: data.nounInfo?.article,
      plural: data.nounInfo?.plural,
      arabicMeaning: data.contextMeaningArabic,
      ipa: data.ipa,
      arabicPronunciation: data.pronunciationArabic,
      partOfSpeech: data.partOfSpeech,
      exampleGerman: data.exampleGerman,
      exampleArabic: data.exampleArabic,
      level,
      sourceTitle,
      mastery: 'learning',
    });
    setIsSaved(true);
  };

  const getArticleBadge = (article?: string) => {
    if (!article) return null;
    const lower = article.toLowerCase().trim();
    if (lower === 'der') {
      return <span className="px-2 py-0.5 text-xs font-bold rounded-md bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300">der (مذكر)</span>;
    }
    if (lower === 'die') {
      return <span className="px-2 py-0.5 text-xs font-bold rounded-md bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300">die (مؤنث)</span>;
    }
    if (lower === 'das') {
      return <span className="px-2 py-0.5 text-xs font-bold rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">das (محايد)</span>;
    }
    return <span className="px-2 py-0.5 text-xs font-bold rounded-md bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{article}</span>;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs transition-opacity animate-in fade-in">
      <div
        className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-right"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">القاموس الألماني التفاعلي</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">معنى فوري ومعلومات لغوية في السياق</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
            title="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 max-h-[75vh] overflow-y-auto space-y-5">
          {/* Main Word Card */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50/40 dark:from-slate-800/80 dark:to-slate-800/30 p-5 rounded-xl border border-blue-100 dark:border-slate-700">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  {data?.nounInfo?.article && getArticleBadge(data.nounInfo.article)}
                  <span className="font-german text-2xl font-black text-slate-900 dark:text-white tracking-wide" dir="ltr">
                    {data?.word || cleanWord}
                  </span>
                  {data?.partOfSpeech && (
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                      {data.partOfSpeech}
                    </span>
                  )}
                </div>

                {/* Pronunciation helpers */}
                <div className="mt-2.5 flex items-center gap-3 text-sm flex-wrap">
                  {data?.pronunciationArabic && (
                    <span className="text-blue-700 dark:text-blue-400 font-semibold flex items-center gap-1">
                      <span className="text-xs text-slate-400">النطق بالعربية:</span>
                      {data.pronunciationArabic}
                    </span>
                  )}
                  {data?.ipa && (
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400 bg-white/70 dark:bg-slate-900/60 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700" dir="ltr">
                      {data.ipa}
                    </span>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePronounce}
                  className={`p-2.5 rounded-xl transition-all shadow-xs flex items-center justify-center ${
                    isPlayingAudio
                      ? 'bg-blue-600 text-white ring-4 ring-blue-200 dark:ring-blue-900'
                      : 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-700 border border-blue-200 dark:border-slate-600'
                  }`}
                  title="نطق الكلمة فقط بصوت نسائي ألماني"
                >
                  <Volume2 className={`w-5 h-5 ${isPlayingAudio ? 'animate-bounce' : ''}`} />
                </button>

                <button
                  onClick={handleSave}
                  className={`p-2.5 rounded-xl transition-all shadow-xs flex items-center justify-center ${
                    isSaved
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600'
                  }`}
                  title={isSaved ? 'محفوظة في مفرداتك' : 'حفظ الكلمة'}
                >
                  {isSaved ? <Check className="w-5 h-5" /> : <Bookmark className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Arabic Contextual Meaning */}
            <div className="mt-4 pt-3 border-t border-blue-100/80 dark:border-slate-700/80">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                المعنى في هذا السياق:
              </span>
              <p className="text-xl font-bold text-slate-900 dark:text-white">
                {loading ? (
                  <span className="inline-block w-40 h-6 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                ) : (
                  data?.contextMeaningArabic || '...'
                )}
              </p>
              {data?.otherMeaningsArabic && data.otherMeaningsArabic.length > 0 && (
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  معانٍ أخرى شائعة: {data.otherMeaningsArabic.join('، ')}
                </p>
              )}
            </div>
          </div>

          {loading && (
            <div className="py-8 text-center text-slate-400 space-y-2">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs">جارٍ استخراج التفاصيل النحوية والتصريفية...</p>
            </div>
          )}

          {audioError && (
            <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 rounded-xl text-xs border border-rose-200 dark:border-rose-900/60 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="truncate font-semibold">{audioError}</span>
              </div>
              <button
                type="button"
                onClick={handlePronounce}
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold"
              >
                <RotateCcw className="w-3 h-3" />
                إعادة المحاولة
              </button>
            </div>
          )}

          {error && (
            <div className="p-4 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 rounded-xl text-sm border border-rose-200 dark:border-rose-900/60">
              {error}
            </div>
          )}

          {data && (
            <div className="space-y-4">
              {/* Grammatical Information: Nouns */}
              {data.nounInfo && (
                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                  <h4 className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                    بيانات الاسم (Nomen)
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-100 dark:border-slate-700">
                      <span className="text-xs text-slate-400 block mb-0.5">المفرد والأداة:</span>
                      <span className="font-german font-semibold text-slate-800 dark:text-slate-100" dir="ltr">
                        {data.nounInfo.article ? `${data.nounInfo.article} ` : ''}
                        {data.nounInfo.singular || data.word}
                      </span>
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-100 dark:border-slate-700">
                      <span className="text-xs text-slate-400 block mb-0.5">صيغة الجمع (Plural):</span>
                      <span className="font-german font-semibold text-slate-800 dark:text-slate-100" dir="ltr">
                        {data.nounInfo.plural || '—'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Grammatical Information: Verbs */}
              {data.verbInfo && (
                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2.5">
                  <h4 className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                    تصريف الفعل (Konjugation)
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-100 dark:border-slate-700">
                      <span className="text-slate-400 block mb-0.5">المصدر (Infinitiv):</span>
                      <span className="font-german font-semibold text-slate-800 dark:text-slate-100" dir="ltr">
                        {data.verbInfo.infinitiv || data.word}
                      </span>
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-100 dark:border-slate-700">
                      <span className="text-slate-400 block mb-0.5">المضارع (Präsens):</span>
                      <span className="font-german font-semibold text-slate-800 dark:text-slate-100" dir="ltr">
                        {data.verbInfo.praesens || '—'}
                      </span>
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-100 dark:border-slate-700">
                      <span className="text-slate-400 block mb-0.5">الماضي (Präteritum):</span>
                      <span className="font-german font-semibold text-slate-800 dark:text-slate-100" dir="ltr">
                        {data.verbInfo.praeteritum || '—'}
                      </span>
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-100 dark:border-slate-700">
                      <span className="text-slate-400 block mb-0.5">التام (Perfekt):</span>
                      <span className="font-german font-semibold text-slate-800 dark:text-slate-100" dir="ltr">
                        {data.verbInfo.perfekt || '—'}
                      </span>
                    </div>
                  </div>
                  {data.verbInfo.auxiliary && (
                    <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                      <span>الفعل المساعد:</span>
                      <span className="font-german font-bold px-2 py-0.5 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded" dir="ltr">
                        {data.verbInfo.auxiliary}
                      </span>
                      {data.verbInfo.isSeparable && (
                        <span className="px-2 py-0.5 bg-amber-50 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded font-semibold">
                          فعل منفصل (trennbare Verb)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Adjective Info */}
              {data.adjectiveInfo && (
                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                  <h4 className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                    درجات المقارنة (Steigerung)
                  </h4>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-100 dark:border-slate-700">
                      <span className="text-slate-400 block mb-0.5">الصفة:</span>
                      <span className="font-german font-semibold text-slate-800 dark:text-slate-100" dir="ltr">{data.adjectiveInfo.base || data.word}</span>
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-100 dark:border-slate-700">
                      <span className="text-slate-400 block mb-0.5">المقارنة:</span>
                      <span className="font-german font-semibold text-slate-800 dark:text-slate-100" dir="ltr">{data.adjectiveInfo.comparative || '—'}</span>
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-100 dark:border-slate-700">
                      <span className="text-slate-400 block mb-0.5">التفضيل:</span>
                      <span className="font-german font-semibold text-slate-800 dark:text-slate-100" dir="ltr">{data.adjectiveInfo.superlative || '—'}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Example sentence */}
              {data.exampleGerman && (
                <div className="bg-blue-50/50 dark:bg-slate-800/40 p-4 rounded-xl border border-blue-100/60 dark:border-slate-700">
                  <span className="text-xs font-semibold text-blue-700 dark:text-blue-400 block mb-1">
                    مثال تعليمي توضيحي:
                  </span>
                  <p className="font-german text-sm font-semibold text-slate-800 dark:text-slate-100 leading-relaxed" dir="ltr">
                    {data.exampleGerman}
                  </p>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    {data.exampleArabic}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <button
            onClick={handlePronounce}
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
          >
            <Volume2 className="w-4 h-4" />
            استماع لنطق الكلمة مجدداً
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-lg transition-colors"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
