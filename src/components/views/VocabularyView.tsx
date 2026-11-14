import React, { useRef, useState } from 'react';
import {
  Bookmark,
  Search,
  Volume2,
  Trash2,
  Download,
  Upload,
  Plus,
  FileText,
  Cloud,
  GraduationCap,
  RotateCcw,
  Check,
  CheckCircle2,
  AlertTriangle,
  X,
  AlertCircle,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { SavedWord, CEFRLevel } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import {
  addSavedWordsBatch,
  pushSavedWordsManuallyToSupabase,
  removeSavedWord,
  saveStoredWords,
  exportWordsToCSV,
} from '../../services/storage';
import { decodeGermanTextBuffer } from '../../utils/audioHash';
import { parseManualWordsInput } from '../../utils/vocabularyImport';
import { analyzeGermanWordLocally } from '../../data/germanDictionary';

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

  // Manual Word / Batch Upload State
  const [isManualUploadOpen, setIsManualUploadOpen] = useState<boolean>(false);
  const [manualTab, setManualTab] = useState<'batch' | 'single'>('batch');
  const [batchText, setBatchText] = useState<string>('');
  const [batchLevel, setBatchLevel] = useState<CEFRLevel>('A2');
  const [syncWordsToSupabase, setSyncWordsToSupabase] = useState<boolean>(true);
  const [isUploadingWords, setIsUploadingWords] = useState<boolean>(false);
  const [isPushingSupabase, setIsPushingSupabase] = useState<boolean>(false);
  const wordFileInputRef = useRef<HTMLInputElement | null>(null);

  // Single-word manual form state
  const [singleGerman, setSingleGerman] = useState<string>('');
  const [singleArticle, setSingleArticle] = useState<string>('');
  const [singlePlural, setSinglePlural] = useState<string>('');
  const [singleArabic, setSingleArabic] = useState<string>('');
  const [singleLevel, setSingleLevel] = useState<CEFRLevel>('A2');
  const [singleExampleDe, setSingleExampleDe] = useState<string>('');
  const [singleExampleAr, setSingleExampleAr] = useState<string>('');

  const [uploadFeedback, setUploadFeedback] = useState<{
    kind: 'success' | 'warning' | 'error';
    title: string;
    message: string;
    details?: string[];
  } | null>(null);

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

  const liveBatchPreview = batchText.trim()
    ? parseManualWordsInput(batchText, batchLevel)
    : { entries: [], invalidLines: [], totalLines: 0 };

  const handleBatchUploadSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setUploadFeedback(null);

    if (!batchText.trim()) {
      setUploadFeedback({
        kind: 'error',
        title: 'فشل رفع الكلمات',
        message: 'يرجى كتابة أو لصق كلمة واحدة على الأقل أو اختيار ملف كلمات (.txt / .csv) قبل الحفظ.',
      });
      return;
    }

    const parsed = parseManualWordsInput(batchText, batchLevel);
    if (parsed.entries.length === 0) {
      setUploadFeedback({
        kind: 'error',
        title: 'فشل تحليل قائمة الكلمات',
        message: 'لم يتم العثور على أي كلمة ألمانية صالحة للحفظ. تأكد من كتابة الكلمة الألمانية ثم معناها بالعربية.',
        details: parsed.invalidLines
          .slice(0, 6)
          .map((item) => `السطر ${item.lineNumber}: ${item.reason} («${item.content}»)`),
      });
      return;
    }

    setIsUploadingWords(true);
    try {
      const result = await addSavedWordsBatch(parsed.entries, {
        syncToSupabase: syncWordsToSupabase,
      });
      onRefreshWords();

      const skippedDetails = parsed.invalidLines
        .slice(0, 5)
        .map((item) => `تم تجاهل السطر ${item.lineNumber}: ${item.reason}`);

      const summaryParts: string[] = [];
      if (result.addedCount > 0) summaryParts.push(`إضافة ${result.addedCount} كلمة جديدة`);
      if (result.updatedCount > 0) summaryParts.push(`تحديث ${result.updatedCount} كلمة موجودة`);

      if (result.cloudAttempted && !result.cloudSynced) {
        setUploadFeedback({
          kind: 'warning',
          title: 'تم الحفظ محلياً مع تعذر المزامنة السحابية',
          message: `تم ${summaryParts.join(' و ')} في المتصفح (IndexedDB)، ولكن فشلت المزامنة مع Supabase: ${
            result.cloudError || 'خطأ غير معروف'
          }`,
          details: skippedDetails.length > 0 ? skippedDetails : undefined,
        });
      } else if (parsed.invalidLines.length > 0) {
        setUploadFeedback({
          kind: 'warning',
          title: 'تم استيراد معظم الكلمات بنجاح',
          message: `تم ${summaryParts.join(' و ')} (${
            result.cloudSynced ? 'محفوظة محلياً ومُزامَنة مع Supabase' : 'محفوظة محلياً في المتصفح'
          })، مع تجاهل ${parsed.invalidLines.length} سطر غير صالح.`,
          details: skippedDetails,
        });
      } else {
        setUploadFeedback({
          kind: 'success',
          title: 'تم رفع الكلمات وحفظها بنجاح',
          message: `تم ${summaryParts.join(' و ')} بنجاح (${
            result.cloudSynced ? 'محفوظة محلياً ومُزامَنة مع السحابة Supabase' : 'محفوظة محلياً في المتصفح'
          }).`,
        });
        setBatchText('');
        setIsManualUploadOpen(false);
      }
    } catch (err: any) {
      console.error('Manual batch word upload failed:', err);
      setUploadFeedback({
        kind: 'error',
        title: 'فشل رفع وحفظ الكلمات',
        message: err?.message || 'حدث خطأ غير متوقع أثناء حفظ الكلمات في التخزين.',
      });
    } finally {
      setIsUploadingWords(false);
    }
  };

  const handleWordFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;

    setUploadFeedback(null);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (!['txt', 'csv'].includes(ext)) {
        throw new Error('صيغة الملف غير مدعومة لجمع الكلمات. يرجى اختيار ملف بصيغة TXT أو CSV.');
      }
      if (file.size === 0) {
        throw new Error('الملف المختار فارغ.');
      }
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('حجم ملف الكلمات كبير جداً (الحد الأقصى 5 MB).');
      }

      const buffer = new Uint8Array(await file.arrayBuffer());
      const decoded = decodeGermanTextBuffer(buffer).trim();
      if (!decoded) {
        throw new Error('لم يتم العثور على أي نص داخل الملف.');
      }

      setBatchText(decoded);
      const preview = parseManualWordsInput(decoded, batchLevel);
      if (preview.entries.length === 0) {
        setUploadFeedback({
          kind: 'error',
          title: `تعذر استخراج كلمات من الملف «${file.name}»`,
          message: 'الملف لا يحتوي على أسطر كلمات ألمانية صالحة.',
          details: preview.invalidLines
            .slice(0, 5)
            .map((item) => `السطر ${item.lineNumber}: ${item.reason}`),
        });
      } else {
        setUploadFeedback({
          kind: 'success',
          title: `تم تحميل الملف «${file.name}»`,
          message: `تم رصد ${preview.entries.length} كلمة جاهزة للحفظ. راجعها واضغط «رفع وحفظ الكلمات».`,
        });
      }
    } catch (err: any) {
      setUploadFeedback({
        kind: 'error',
        title: 'فشل قراءة ملف الكلمات',
        message: err?.message || 'تعذر قراءة الملف المختار.',
      });
    } finally {
      input.value = '';
    }
  };

  const handleSingleWordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadFeedback(null);

    const cleanGerman = singleGerman.trim();
    const cleanArabic = singleArabic.trim();

    if (!cleanGerman || !/[a-zA-ZäöüÄÖÜß]/.test(cleanGerman)) {
      setUploadFeedback({
        kind: 'error',
        title: 'فشل إضافة الكلمة',
        message: 'يرجى إدخال كلمة ألمانية صحيحة تحتوي على حروف ألمانية.',
      });
      return;
    }

    if (!cleanArabic) {
      setUploadFeedback({
        kind: 'error',
        title: 'فشل إضافة الكلمة',
        message: 'يرجى إدخال المعنى بالعربية لهذه الكلمة.',
      });
      return;
    }

    setIsUploadingWords(true);
    try {
      const analyzed = analyzeGermanWordLocally(cleanGerman);
      const result = await addSavedWordsBatch(
        [
          {
            germanWord: cleanGerman,
            article: singleArticle.trim() || analyzed.nounInfo?.article,
            plural: singlePlural.trim() || analyzed.nounInfo?.plural,
            arabicMeaning: cleanArabic,
            ipa: analyzed.ipa,
            arabicPronunciation: analyzed.pronunciationArabic,
            partOfSpeech: analyzed.partOfSpeech,
            exampleGerman: singleExampleDe.trim() || analyzed.exampleGerman,
            exampleArabic: singleExampleAr.trim() || analyzed.exampleArabic,
            level: singleLevel,
            sourceTitle: 'إضافة يدوية',
            mastery: 'learning',
          },
        ],
        { syncToSupabase: syncWordsToSupabase }
      );
      onRefreshWords();

      if (result.cloudAttempted && !result.cloudSynced) {
        setUploadFeedback({
          kind: 'warning',
          title: `تم حفظ «${cleanGerman}» محلياً فقط`,
          message: `تعذرت المزامنة مع السحابة Supabase: ${result.cloudError || 'خطأ غير معروف'}`,
        });
      } else {
        setUploadFeedback({
          kind: 'success',
          title: `تم حفظ الكلمة «${cleanGerman}» بنجاح`,
          message: result.cloudSynced
            ? 'تمت إضافة الكلمة إلى مفرداتك ومزامنتها مع Supabase.'
            : 'تمت إضافة الكلمة بنجاح إلى مفرداتك المحفوظة محلياً.',
        });
        setSingleGerman('');
        setSingleArticle('');
        setSinglePlural('');
        setSingleArabic('');
        setSingleExampleDe('');
        setSingleExampleAr('');
      }
    } catch (err: any) {
      setUploadFeedback({
        kind: 'error',
        title: 'فشل حفظ الكلمة',
        message: err?.message || 'حدث خطأ أثناء حفظ الكلمة.',
      });
    } finally {
      setIsUploadingWords(false);
    }
  };

  const handleManualPushWordsToSupabase = async () => {
    setUploadFeedback(null);
    setIsPushingSupabase(true);
    try {
      const res = await pushSavedWordsManuallyToSupabase();
      setUploadFeedback({
        kind: 'success',
        title: 'تم رفع المفردات إلى Supabase بنجاح',
        message: `تم رفع ومزامنة جميع المفردات (${res.count} كلمة) إلى حسابك في Supabase.`,
      });
    } catch (err: any) {
      setUploadFeedback({
        kind: 'error',
        title: 'فشل رفع المفردات إلى Supabase',
        message: err?.message || 'تعذر الرفع اليدوي إلى Supabase.',
      });
    } finally {
      setIsPushingSupabase(false);
    }
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
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setIsManualUploadOpen((prev) => !prev);
              setUploadFeedback(null);
            }}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 transition-all ${
              isManualUploadOpen
                ? 'bg-emerald-700 text-white'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>رفع / إضافة كلمات يدوياً</span>
          </button>

          <button
            onClick={() => startReview(10)}
            disabled={savedWords.length === 0}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-bold shadow-xs flex items-center gap-1.5 transition-all"
          >
            <GraduationCap className="w-4 h-4" />
            <span>مراجعة بالبطاقات (10 كلمات)</span>
          </button>

          <button
            type="button"
            onClick={handleManualPushWordsToSupabase}
            disabled={savedWords.length === 0 || isPushingSupabase}
            className="px-3.5 py-2.5 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 disabled:opacity-40 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center gap-1.5 transition-all"
            title="رفع جميع كلماتك المحفوظة إلى Supabase يدوياً"
          >
            <Cloud className="w-4 h-4" />
            <span>{isPushingSupabase ? 'جارٍ الرفع...' : 'رفع إلى Supabase'}</span>
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

      {/* SUCCESS / WARNING / ERROR MESSAGE FOR MANUAL WORD UPLOAD */}
      {uploadFeedback && (
        <div
          role={uploadFeedback.kind === 'error' ? 'alert' : 'status'}
          className={`p-4 rounded-2xl border text-xs flex items-start justify-between gap-3 animate-in fade-in ${
            uploadFeedback.kind === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800'
              : uploadFeedback.kind === 'warning'
              ? 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800'
              : 'bg-rose-50 text-rose-900 border-rose-200 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-800'
          }`}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            {uploadFeedback.kind === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            ) : uploadFeedback.kind === 'warning' ? (
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1 min-w-0">
              <p className="font-bold text-sm">{uploadFeedback.title}</p>
              <p className="leading-relaxed">{uploadFeedback.message}</p>
              {uploadFeedback.details && uploadFeedback.details.length > 0 && (
                <ul className="list-disc list-inside space-y-0.5 pt-1 opacity-90">
                  {uploadFeedback.details.map((detail, idx) => (
                    <li key={idx}>{detail}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setUploadFeedback(null)}
            className="p-1 rounded-lg opacity-70 hover:opacity-100 shrink-0"
            aria-label="إغلاق الرسالة"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* MANUAL BATCH & SINGLE WORD UPLOAD PANEL */}
      {isManualUploadOpen && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-emerald-200/80 dark:border-emerald-900/60 shadow-sm space-y-5 animate-in fade-in">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Upload className="w-5 h-5 text-emerald-600" />
                <span>رفع وإضافة الكلمات يدوياً</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                أدخل مجموعة كلمات ألمانية دفعة واحدة (أو ارفع ملف TXT / CSV) ليتم حفظها في مفرداتك ومزامنتها.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setManualTab('batch')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    manualTab === 'batch'
                      ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  رفع مجموعة كلمات
                </button>
                <button
                  type="button"
                  onClick={() => setManualTab('single')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    manualTab === 'single'
                      ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  كلمة واحدة بالتفصيل
                </button>
              </div>
              <button
                type="button"
                onClick={() => setIsManualUploadOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="إغلاق لوحة رفع الكلمات"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {manualTab === 'batch' ? (
            <form onSubmit={handleBatchUploadSubmit} className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-800 dark:text-slate-100">
                    صيغ الإدخال المدعومة (كلمة في كل سطر):
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setBatchText(
                          'der Tisch - الطاولة\ndie Entscheidung - القرار\ndas Arbeitsklima : بيئة العمل\nunterstützen = يدعم / يساند\nzuverlässig - موثوق'
                        )
                      }
                      className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold text-[11px]"
                    >
                      إدراج مثال توضيحي
                    </button>
                    <input
                      ref={wordFileInputRef}
                      type="file"
                      accept=".txt,.csv,text/plain,text/csv"
                      onChange={handleWordFileSelected}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => wordFileInputRef.current?.click()}
                      className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold text-[11px] flex items-center gap-1"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>استيراد من ملف TXT / CSV</span>
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed" dir="rtl">
                  مثال: <code className="px-1 py-0.5 rounded bg-white dark:bg-slate-900" dir="ltr">der Tisch - الطاولة</code> أو{' '}
                  <code className="px-1 py-0.5 rounded bg-white dark:bg-slate-900" dir="ltr">arbeiten = يعمل</code> أو{' '}
                  <code className="px-1 py-0.5 rounded bg-white dark:bg-slate-900" dir="ltr">Haus, Beruf, lernen</code> (كما يدعم ملفات CSV المُصدَّرة من التطبيق).
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    المستوى الافتراضي للكلمات:
                  </label>
                  <select
                    value={batchLevel}
                    onChange={(e) => setBatchLevel(e.target.value as CEFRLevel)}
                    className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 font-bold"
                  >
                    <option value="A1">A1</option>
                    <option value="A2">A2</option>
                    <option value="B1">B1</option>
                    <option value="B2">B2</option>
                    <option value="C1">C1</option>
                    <option value="C2">C2</option>
                  </select>
                </div>

                {batchText.trim() && (
                  <div className="text-xs font-bold flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                      كلمات صالحة مرصودة: {liveBatchPreview.entries.length}
                    </span>
                    {liveBatchPreview.invalidLines.length > 0 && (
                      <span className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                        أسطر غير صالحة: {liveBatchPreview.invalidLines.length}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <textarea
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
                rows={6}
                dir="auto"
                placeholder={'der Tisch - الطاولة\ndie Hoffnung - الأمل\narbeiten = يعمل'}
                className="w-full p-4 text-sm font-german bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 leading-relaxed"
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncWordsToSupabase}
                    onChange={(e) => setSyncWordsToSupabase(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>رفع تلقائي إلى Supabase عند الحفظ (أو اتركه مغلقاً للحفظ محلياً فقط والرفع يدوياً لاحقاً)</span>
                </label>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setBatchText('')}
                    disabled={!batchText || isUploadingWords}
                    className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                  >
                    مسح الحقل
                  </button>
                  <button
                    type="submit"
                    disabled={isUploadingWords}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold shadow-sm flex items-center gap-2 transition-all"
                  >
                    {isUploadingWords ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    <span>رفع وحفظ الكلمات ({liveBatchPreview.entries.length})</span>
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSingleWordSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                    الكلمة الألمانية *
                  </label>
                  <input
                    type="text"
                    value={singleGerman}
                    onChange={(e) => setSingleGerman(e.target.value)}
                    placeholder="مثال: Entscheidung أو arbeiten"
                    dir="ltr"
                    className="w-full px-3.5 py-2.5 text-sm font-german bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                    الأداة (اختياري)
                  </label>
                  <select
                    value={singleArticle}
                    onChange={(e) => setSingleArticle(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm font-german bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                  >
                    <option value="">تلقائي / بدون</option>
                    <option value="der">der</option>
                    <option value="die">die</option>
                    <option value="das">das</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                    المستوى
                  </label>
                  <select
                    value={singleLevel}
                    onChange={(e) => setSingleLevel(e.target.value as CEFRLevel)}
                    className="w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-bold"
                  >
                    <option value="A1">A1</option>
                    <option value="A2">A2</option>
                    <option value="B1">B1</option>
                    <option value="B2">B2</option>
                    <option value="C1">C1</option>
                    <option value="C2">C2</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                    المعنى بالعربية *
                  </label>
                  <input
                    type="text"
                    value={singleArabic}
                    onChange={(e) => setSingleArabic(e.target.value)}
                    placeholder="مثال: القرار"
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                    صيغة الجمع (اختياري)
                  </label>
                  <input
                    type="text"
                    value={singlePlural}
                    onChange={(e) => setSinglePlural(e.target.value)}
                    placeholder="مثال: die Entscheidungen"
                    dir="ltr"
                    className="w-full px-3.5 py-2.5 text-sm font-german bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                    مثال بالألمانية (اختياري)
                  </label>
                  <input
                    type="text"
                    value={singleExampleDe}
                    onChange={(e) => setSingleExampleDe(e.target.value)}
                    placeholder="Das ist eine wichtige Entscheidung."
                    dir="ltr"
                    className="w-full px-3.5 py-2.5 text-xs font-german bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                    ترجمة المثال بالعربية (اختياري)
                  </label>
                  <input
                    type="text"
                    value={singleExampleAr}
                    onChange={(e) => setSingleExampleAr(e.target.value)}
                    placeholder="هذا قرار مهم."
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncWordsToSupabase}
                    onChange={(e) => setSyncWordsToSupabase(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>رفع تلقائي إلى Supabase عند الحفظ (أو اتركه مغلقاً للرفع يدوياً لاحقاً)</span>
                </label>

                <button
                  type="submit"
                  disabled={isUploadingWords}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold shadow-sm flex items-center gap-2 transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة وحفظ الكلمة</span>
                </button>
              </div>
            </form>
          )}
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
                      <button
                        type="button"
                        onClick={() => handlePronounce(word.germanWord)}
                        className="font-german text-lg font-bold text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-left"
                        dir="ltr"
                        title="انقر للاستماع لنطق الكلمة"
                      >
                        {word.germanWord}
                      </button>
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
