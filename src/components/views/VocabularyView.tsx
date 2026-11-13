import React, { useState } from 'react';
import {
  Bookmark,
  Search,
  Volume2,
  Trash2,
  Download,
  GraduationCap,
  Sparkles,
  RotateCcw,
  Check,
  X,
  Layers,
  ArrowRight,
  ArrowLeft,
  BookOpen,
  AlertCircle,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { SavedWord, CEFRLevel } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { removeSavedWord, saveStoredWords, exportWordsToCSV } from '../../services/storage';

interface VocabularyViewProps {
  savedWords: SavedWord[];
  onRefreshWords: () => void;
}

export const VocabularyView: React.FC<VocabularyViewProps> = ({
  savedWords,
  onRefreshWords,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [filterPos, setFilterPos] = useState<string>('all');

  // Flashcards Review Mode State
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [reviewCount, setReviewCount] = useState<number>(10);
  const [reviewList, setReviewList] = useState<SavedWord[]>([]);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [reviewedFinished, setReviewedFinished] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [lastSpokenWord, setLastSpokenWord] = useState<string>('');

  // Filtered words
  const filteredWords = savedWords.filter((w) => {
    const matchesSearch =
      w.germanWord.toLowerCase().includes(searchTerm.toLowerCase()) ||
      w.arabicMeaning.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesLevel = filterLevel === 'all' || w.level === filterLevel;
    const matchesPos = filterPos === 'all' || (w.partOfSpeech && w.partOfSpeech.toLowerCase().includes(filterPos.toLowerCase()));
    return matchesSearch && matchesLevel && matchesPos;
  });

  const handleDelete = (id: string) => {
    removeSavedWord(id);
    onRefreshWords();
  };

  const handlePronounce = async (word: string) => {
    if (!word) return;
    setAudioError(null);
    setLastSpokenWord(word);
    const ok = await audioEngine.playWordOnly(word);
    if (!ok) {
      setAudioError(audioEngine.getLastError() || 'تعذر توليد النطق عبر ElevenLabs.');
    }
  };

  const handleExport = () => {
    exportWordsToCSV(savedWords);
  };

  // -------------------------------------------------------------
  // Flashcard Review Flow
  // -------------------------------------------------------------
  const startReview = (count: number) => {
    const shuffled = [...savedWords].sort(() => 0.5 - Math.random());
    const selected = count === 0 ? shuffled : shuffled.slice(0, count);
    setReviewList(selected);
    setCurrentCardIndex(0);
    setIsFlipped(false);
    setReviewedFinished(false);
    setIsReviewMode(true);
  };

  const handleNextCard = (mastery: 'mastered' | 'review' | 'learning') => {
    const currentWord = reviewList[currentCardIndex];
    if (currentWord) {
      currentWord.mastery = mastery;
      const all = [...savedWords];
      const idx = all.findIndex((w) => w.id === currentWord.id);
      if (idx >= 0) {
        all[idx].mastery = mastery;
        saveStoredWords(all);
        onRefreshWords();
      }
    }

    if (currentCardIndex + 1 < reviewList.length) {
      setCurrentCardIndex(currentCardIndex + 1);
      setIsFlipped(false);
    } else {
      setReviewedFinished(true);
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
      });
    }
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80 dark:border-slate-800">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-xs font-bold mb-1">
            <Bookmark className="w-3.5 h-3.5" />
            <span>مكتبة المفردات الشخصية</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
            كلماتي المحفوظة والبطاقات التعليمية
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            راجع مفرداتك الألمانية المحفوظة من نصوص القراءة، واختبر تذكرك عبر البطاقات التفاعلية.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => startReview(10)}
            disabled={savedWords.length === 0}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-bold shadow-xs flex items-center gap-1.5 transition-all"
          >
            <GraduationCap className="w-4 h-4" />
            <span>مراجعة بالبطاقات (10 كلمات)</span>
          </button>

          <button
            onClick={handleExport}
            disabled={savedWords.length === 0}
            className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            title="تصدير الكلمات كملف Excel / CSV"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {audioError && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 rounded-2xl text-xs border border-rose-200 dark:border-rose-900/60 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="truncate font-semibold">{audioError}</span>
          </div>
          <button
            type="button"
            onClick={() => handlePronounce(lastSpokenWord)}
            className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* FLASHCARD MODAL / VIEW */}
      {isReviewMode && (
        <div className="p-6 sm:p-10 bg-gradient-to-br from-indigo-900 via-slate-900 to-blue-950 text-white rounded-3xl shadow-2xl border border-slate-800 space-y-6 relative overflow-hidden animate-in zoom-in-95">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-blue-400" />
              <span className="text-xs font-bold text-slate-300">
                مراجعة البطاقات: {currentCardIndex + 1} من {reviewList.length}
              </span>
            </div>
            <button
              onClick={() => setIsReviewMode(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              إنهاء المراجعة
            </button>
          </div>

          {!reviewedFinished && reviewList[currentCardIndex] && (
            <div className="space-y-6 max-w-xl mx-auto">
              {/* Interactive Flip Card */}
              <div
                onClick={() => setIsFlipped(!isFlipped)}
                className="min-h-[260px] bg-white/10 backdrop-blur-md rounded-3xl p-8 border border-white/20 flex flex-col justify-between cursor-pointer hover:bg-white/15 transition-all text-center relative shadow-xl"
              >
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="px-2 py-0.5 rounded bg-white/10 font-bold">
                    CEFR {reviewList[currentCardIndex].level}
                  </span>
                  <span>اضغط لقلب البطاقة ↻</span>
                </div>

                {!isFlipped ? (
                  /* FRONT: German Word */
                  <div className="py-6 space-y-3">
                    <span className="text-xs text-blue-300 font-semibold block">الكلمة بالألمانية:</span>
                    <h3 className="font-german text-3xl sm:text-4xl font-black text-white tracking-wide" dir="ltr">
                      {reviewList[currentCardIndex].article && (
                        <span className="text-blue-300 mr-2 text-2xl font-bold">
                          {reviewList[currentCardIndex].article}
                        </span>
                      )}
                      {reviewList[currentCardIndex].germanWord}
                    </h3>
                    {reviewList[currentCardIndex].plural && (
                      <span className="font-german text-xs text-slate-300 block" dir="ltr">
                        Plural: {reviewList[currentCardIndex].plural}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePronounce(reviewList[currentCardIndex].germanWord);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white text-xs font-bold transition-colors mt-2"
                    >
                      <Volume2 className="w-4 h-4" />
                      استمع للنطق
                    </button>
                  </div>
                ) : (
                  /* BACK: Arabic translation & details */
                  <div className="py-6 space-y-3 animate-in fade-in">
                    <span className="text-xs text-emerald-400 font-semibold block">المعنى بالعربية:</span>
                    <h3 className="text-2xl sm:text-3xl font-black text-white font-arabic">
                      {reviewList[currentCardIndex].arabicMeaning}
                    </h3>
                    {reviewList[currentCardIndex].arabicPronunciation && (
                      <span className="text-sm text-blue-300 font-medium block">
                        النطق بالعربية: {reviewList[currentCardIndex].arabicPronunciation}
                      </span>
                    )}
                    {reviewList[currentCardIndex].exampleGerman && (
                      <div className="p-3 bg-black/30 rounded-xl text-xs text-slate-200 mt-2 font-german text-right" dir="ltr">
                        {reviewList[currentCardIndex].exampleGerman}
                      </div>
                    )}
                  </div>
                )}

                <div className="text-[11px] text-slate-400 font-medium">
                  {isFlipped ? 'قيّم معرفتك بالكلمة بالأسفل' : 'خمّن المعنى والنطق ثم انقر للتحقق'}
                </div>
              </div>

              {/* Assessment buttons */}
              {isFlipped && (
                <div className="grid grid-cols-3 gap-3">
                  <button
                    onClick={() => handleNextCard('learning')}
                    className="py-3 px-2 rounded-xl bg-rose-600/90 hover:bg-rose-600 text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1"
                  >
                    <X className="w-4 h-4" />
                    <span>لا أعرفها (إعادة)</span>
                  </button>

                  <button
                    onClick={() => handleNextCard('review')}
                    className="py-3 px-2 rounded-xl bg-amber-600/90 hover:bg-amber-600 text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>أحتاج تدريباً</span>
                  </button>

                  <button
                    onClick={() => handleNextCard('mastered')}
                    className="py-3 px-2 rounded-xl bg-emerald-600/90 hover:bg-emerald-600 text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1"
                  >
                    <Check className="w-4 h-4" />
                    <span>أعرفها جيداً!</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {reviewedFinished && (
            <div className="py-12 text-center space-y-4 max-w-sm mx-auto">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto text-2xl font-black">
                ✓
              </div>
              <h3 className="text-xl font-bold">أحسنت! أكملت مراجعة الجلسة بنجاح</h3>
              <p className="text-xs text-slate-300">
                الاستمرار اليومي والمراجعة المتباعدة هما سر إتقان مفردات اللغة الألمانية.
              </p>
              <button
                onClick={() => setIsReviewMode(false)}
                className="px-6 py-2.5 rounded-xl bg-white text-slate-900 font-bold text-xs hover:bg-slate-100 transition-colors"
              >
                العودة لقائمة المفردات
              </button>
            </div>
          )}
        </div>
      )}

      {/* SEARCH AND FILTERS */}
      <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ابحث بالكلمة الألمانية أو المعنى العربي..."
            className="w-full pr-9 pl-4 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
          />
        </div>

        {/* Filter by Level */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-400 font-medium">المستوى:</span>
          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200"
          >
            <option value="all">كل المستويات ({savedWords.length})</option>
            <option value="A1">A1</option>
            <option value="A2">A2</option>
            <option value="B1">B1</option>
            <option value="B2">B2</option>
            <option value="C1">C1</option>
            <option value="C2">C2</option>
          </select>
        </div>

        {/* Review options dropdown */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => startReview(5)}
            className="px-2.5 py-2 text-xs rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-blue-50 font-semibold"
          >
            مراجعة 5
          </button>
          <button
            onClick={() => startReview(20)}
            className="px-2.5 py-2 text-xs rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-blue-50 font-semibold"
          >
            مراجعة 20
          </button>
        </div>
      </div>

      {/* WORDS LIST */}
      {filteredWords.length === 0 ? (
        <div className="py-16 text-center space-y-3 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 mx-auto flex items-center justify-center">
            <Bookmark className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-slate-700 dark:text-slate-200 text-base">لا توجد كلمات محفوظة تطابق البحث</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            انقر على أي كلمة أثناء قراءة النصوص الألمانية واضغط على أيقونة الإشارة المرجعية لإضافتها إلى مفرداتك.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredWords.map((word) => (
            <div
              key={word.id}
              className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md transition-all flex flex-col justify-between"
            >
              <div className="space-y-3">
                {/* Header row */}
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {word.article && (
                        <span className={`px-2 py-0.5 text-xs font-bold rounded-md border ${getArticleColor(word.article)}`}>
                          {word.article}
                        </span>
                      )}
                      <span className="font-german text-lg font-bold text-slate-900 dark:text-white" dir="ltr">
                        {word.germanWord}
                      </span>
                    </div>

                    {word.plural && (
                      <span className="font-german text-[11px] text-slate-400 block mt-0.5" dir="ltr">
                        Plural: {word.plural}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handlePronounce(word.germanWord)}
                      className="p-1.5 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors"
                      title="استمع لنطق الكلمة"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(word.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                      title="حذف من المفردات"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Meaning & Pronunciation */}
                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100 font-arabic">
                    {word.arabicMeaning}
                  </p>
                  {word.arabicPronunciation && (
                    <span className="text-xs text-blue-700 dark:text-blue-400 font-medium block">
                      النطق بالعربية: {word.arabicPronunciation}
                    </span>
                  )}
                  {word.ipa && (
                    <span className="font-mono text-[10px] text-slate-400 block" dir="ltr">
                      {word.ipa}
                    </span>
                  )}
                </div>

                {/* Example */}
                {word.exampleGerman && (
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-xs space-y-1">
                    <p className="font-german text-slate-800 dark:text-slate-200" dir="ltr">
                      {word.exampleGerman}
                    </p>
                    {word.exampleArabic && (
                      <p className="text-slate-500 dark:text-slate-400 text-[11px]">
                        {word.exampleArabic}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Card Footer */}
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-bold">
                  CEFR {word.level}
                </span>
                <span>
                  {word.mastery === 'mastered' && '✓ تم الحفظ'}
                  {word.mastery === 'review' && '⏳ قيد المراجعة'}
                  {word.mastery === 'learning' && '📖 كلمة جديدة'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
