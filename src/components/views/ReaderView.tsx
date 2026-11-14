import React, { useState, useEffect, useRef } from 'react';
import {
  Volume2,
  BookOpen,
  Bookmark,
  Maximize2,
  Minimize2,
  Clock,
  Upload,
  Info,
  Eye,
  EyeOff,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { GermanTextPassage, ReadingSettings } from '../../types';
import { audioEngine, PlaybackState } from '../../services/audioEngine';
import { WordDictionaryModal } from '../modals/WordDictionaryModal';
import { SentenceModal } from '../modals/SentenceModal';
import {
  addTextPassage,
  recordReadingHistoryProgress,
  updateStats,
} from '../../services/storage';
import { uploadFileToSupabaseStorage } from '../../services/supabaseSync';
import { decodeGermanTextBuffer, formatBytes, splitGermanSentences } from '../../utils/audioHash';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // matches the `german-learning` bucket limit
// Vercel serverless functions reject request bodies above ~4.5 MB; base64 adds ~33%.
const MAX_SERVER_PARSE_BYTES = 3 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      if (comma < 0) reject(new Error('فشل في قراءة محتوى الملف'));
      else resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error || new Error('فشل في قراءة محتوى الملف'));
    reader.readAsDataURL(file);
  });
}

interface ReaderViewProps {
  passage: GermanTextPassage | null;
  settings: ReadingSettings;
  onUpdateSettings: (newSettings: Partial<ReadingSettings>) => void;
  onSelectPassage: (passage: GermanTextPassage) => void;
  initialTab?: 'reading' | 'import';
  onTabChange?: (tab: 'reading' | 'import') => void;
}

export const ReaderView: React.FC<ReaderViewProps> = ({
  passage,
  settings,
  onUpdateSettings,
  onSelectPassage,
  initialTab = 'reading',
  onTabChange,
}) => {
  const [playbackState, setPlaybackState] = useState<PlaybackState>(audioEngine.getState());
  const [audioError, setAudioError] = useState<string | null>(audioEngine.getLastError());
  const [activeSentenceIndex, setActiveSentenceIndex] = useState<number>(0);

  // Modals state
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [selectedSentenceContext, setSelectedSentenceContext] = useState<string>('');
  const [isWordModalOpen, setIsWordModalOpen] = useState<boolean>(false);

  const [selectedSentenceForModal, setSelectedSentenceForModal] = useState<string | null>(null);
  const [isSentenceModalOpen, setIsSentenceModalOpen] = useState<boolean>(false);

  // Reader display options
  const [showArabicTranslation, setShowArabicTranslation] = useState<boolean>(true);
  const [fontSize, setFontSize] = useState<'normal' | 'large' | 'xlarge'>('large');
  const [activeTab, setActiveTab] = useState<'reading' | 'import'>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const switchTab = (tab: 'reading' | 'import') => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };

  // Document upload state
  const [inputText, setInputText] = useState<string>('');
  const [inputTitle, setInputTitle] = useState<string>('');
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<{ kind: 'success' | 'warning'; text: string } | null>(null);

  useEffect(() => {
    if (!importNotice) return;
    const t = setTimeout(() => setImportNotice(null), 12000);
    return () => clearTimeout(t);
  }, [importNotice]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Timer state
  const [timerRemainingSeconds, setTimerRemainingSeconds] = useState<number | null>(null);

  // Sentence refs for auto scrolling
  const sentenceRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // Initialize sentences in AudioEngine (local IndexedDB reading history)
  useEffect(() => {
    if (passage && passage.sentences && passage.sentences.length > 0) {
      const startIdx = passage.lastReadSentenceIndex || 0;
      audioEngine.loadSentences(passage.sentences, startIdx);
      setActiveSentenceIndex(startIdx);
      setAudioError(null);
    }
  }, [passage]);

  // AudioEngine listeners
  useEffect(() => {
    const unsubState = audioEngine.onStateChange((st) => {
      setPlaybackState(st);
      if (st === 'playing' || st === 'loading' || st === 'stopped') {
        setAudioError(null);
      }
    });
    const unsubError = audioEngine.onError((msg) => {
      setAudioError(msg);
    });
    const unsubSentence = audioEngine.onSentenceChange((idx) => {
      setActiveSentenceIndex(idx);
      updateStats({ sentencesRead: 1 });
      if (passage) {
        recordReadingHistoryProgress(passage, idx);
      }

      // Auto scroll to active sentence
      if (settings.autoScroll && sentenceRefs.current[idx]) {
        sentenceRefs.current[idx]?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    });

    return () => {
      unsubState();
      unsubError();
      unsubSentence();
    };
  }, [settings.autoScroll, passage]);

  // Session Timer countdown
  useEffect(() => {
    if (settings.timerMinutes <= 0) {
      setTimerRemainingSeconds(null);
      return;
    }

    setTimerRemainingSeconds(settings.timerMinutes * 60);

    const interval = setInterval(() => {
      setTimerRemainingSeconds((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          audioEngine.pause();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [settings.timerMinutes]);

  const formatTimer = (sec: number | null) => {
    if (sec === null) return '';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Word Click Handler (Pronounce ONLY that word via ElevenLabs + show Arabic dictionary)
  const handleWordClick = (e: React.MouseEvent, word: string, sentence: string) => {
    e.stopPropagation();
    const clean = word.replace(/[.,!?;:„"“»«()]/g, '').trim();
    if (!clean) return;

    setSelectedWord(clean);
    setSelectedSentenceContext(sentence);
    setIsWordModalOpen(true);

    audioEngine.playWordOnly(clean);
  };

  const handleSentenceClick = (sentence: string) => {
    setSelectedSentenceForModal(sentence);
    setIsSentenceModalOpen(true);
  };

  const handlePlayFromSentence = (idx: number) => {
    audioEngine.play(idx);
  };

  // Document Upload & Paste (TXT / PDF / DOCX stored locally in IndexedDB)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportError(null);
    setImportNotice(null);

    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (!['txt', 'pdf', 'docx'].includes(ext)) {
        throw new Error('نوع الملف غير مدعوم. الأنواع المدعومة: TXT و PDF و DOCX.');
      }
      if (file.size === 0) {
        throw new Error('الملف فارغ.');
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error(`حجم الملف (${formatBytes(file.size)}) يتجاوز الحد الأقصى 25 MB.`);
      }

      let parsed: { text: string; sentences: string[]; wordCount: number };

      if (ext === 'txt') {
        // Plain text is decoded in the browser: no server round-trip, no request-size limit.
        const text = decodeGermanTextBuffer(new Uint8Array(await file.arrayBuffer()))
          .replace(/\r\n?/g, '\n')
          .trim();
        const sentences = splitGermanSentences(text);
        parsed = { text, sentences, wordCount: text.split(/\s+/).filter(Boolean).length };
      } else {
        if (file.size > MAX_SERVER_PARSE_BYTES) {
          throw new Error(
            `ملفات ${ext.toUpperCase()} الأكبر من ${formatBytes(MAX_SERVER_PARSE_BYTES)} غير مدعومة (حجم هذا الملف ${formatBytes(file.size)}). قسّم الملف أو استخدم TXT أو الصق النص.`
          );
        }

        const res = await fetch('/api/parse-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            fileContentBase64: await fileToBase64(file),
            fileType: ext,
          }),
        });

        if (res.status === 413) {
          throw new Error('الملف كبير جداً بالنسبة للخادم. جرّب ملفاً أصغر أو بصيغة TXT.');
        }

        const rawText = await res.text();
        let data: any;
        try {
          data = JSON.parse(rawText);
        } catch {
          throw new Error(`استجابة غير صالحة أثناء معالجة المستند (HTTP ${res.status})`);
        }

        if (!res.ok || !data.success) {
          throw new Error(data.error || 'تعذر معالجة المستند');
        }
        parsed = data.data;
      }

      if (!parsed.text || parsed.sentences.length === 0) {
        throw new Error('لم يتم العثور على نص قابل للقراءة داخل الملف. إذا كان PDF ممسوحاً ضوئياً (صور) فلا يمكن استخراج نصه.');
      }

      let storageMeta: {
        storagePath: string;
        fileName: string;
        fileSize: number;
        mimeType: string;
      } | null = null;
      let cloudFailure: string | null = null;
      try {
        storageMeta = await uploadFileToSupabaseStorage(file);
      } catch (uploadErr: any) {
        // The text is still imported locally; the notice below tells the user why it is local-only.
        console.warn('Supabase storage upload skipped/failed:', uploadErr?.message || uploadErr);
        cloudFailure = uploadErr?.message || 'خطأ غير معروف';
      }

      const newPassage: GermanTextPassage = {
        id: 'import-' + Date.now(),
        title: file.name.replace(/\.[^/.]+$/, ''),
        authorInfo: storageMeta ? 'مستند مستورد (سحابي + محلي)' : 'مستند مستورد (محلي)',
        level: settings.defaultLevel || 'A2',
        germanText: parsed.text,
        sentences: parsed.sentences,
        arabicSummary: '',
        keyVocabulary: [],
        wordCount: parsed.wordCount,
        style: 'Imported Document',
        topic: file.name,
        storagePath: storageMeta?.storagePath,
        fileName: storageMeta?.fileName || file.name,
        fileSize: storageMeta?.fileSize || file.size,
        mimeType: storageMeta?.mimeType || file.type || undefined,
        createdAt: new Date().toISOString(),
      };

      addTextPassage(newPassage);
      onSelectPassage(newPassage);
      switchTab('reading');

      const summary = `«${file.name}» — ${parsed.sentences.length} جملة، ${parsed.wordCount} كلمة`;
      if (storageMeta) {
        setImportNotice({
          kind: 'success',
          text: `✓ تم الاستيراد بنجاح: ${summary}. وتم حفظ نسخة من الملف في السحابة (Supabase).`,
        });
      } else {
        setImportNotice({
          kind: 'warning',
          text: `✓ تم الاستيراد محلياً: ${summary}. لم يُحفظ في السحابة: ${
            cloudFailure || 'سجّل الدخول بحساب Supabase لحفظ الملف في السحابة.'
          }`,
        });
      }
    } catch (err: any) {
      console.error(err);
      setImportError(err?.message || 'خطأ في معالجة الملف');
    } finally {
      setIsImporting(false);
      // Reset so picking the same file again fires onChange (otherwise a retry does nothing).
      input.value = '';
    }
  };

  const handleManualImport = () => {
    if (!inputText.trim()) return;

    const parsedSentences = splitGermanSentences(inputText.trim());
    const sentences = parsedSentences.length > 0 ? parsedSentences : [inputText.trim()];

    const newPassage: GermanTextPassage = {
      id: 'import-manual-' + Date.now(),
      title: inputTitle.trim() || 'نص ألماني مخصص',
      authorInfo: 'نص مُدخل يدوياً (محلي)',
      level: settings.defaultLevel || 'A2',
      germanText: inputText.trim(),
      sentences: sentences,
      arabicSummary: '',
      keyVocabulary: [],
      wordCount: inputText.split(/\s+/).filter(Boolean).length,
      style: 'Custom Text',
      topic: 'مستند مخصص',
      createdAt: new Date().toISOString(),
    };

    addTextPassage(newPassage);
    onSelectPassage(newPassage);
    setInputText('');
    setInputTitle('');
    switchTab('reading');
  };

  if (!passage && activeTab !== 'import') {
    return (
      <div className="py-20 text-center space-y-4 max-w-md mx-auto" dir="rtl">
        <div className="w-16 h-16 rounded-3xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 flex items-center justify-center mx-auto shadow-sm">
          <BookOpen className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">لا يوجد نص محدد للقراءة</h2>
        <p className="text-xs text-slate-400">
          اختر نصاً من المكتبة أو أدخل نصاً يدوياً أو ارفع ملف TXT / PDF / DOCX للاستماع إليه.
        </p>
        <button
          onClick={() => switchTab('import')}
          className="px-6 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md transition-all flex items-center gap-2 mx-auto"
        >
          <Upload className="w-4 h-4" />
          <span>إدخال أو استيراد نص ألماني</span>
        </button>
      </div>
    );
  }

  const fontSizeClasses = {
    normal: 'text-base sm:text-lg leading-relaxed sm:leading-loose',
    large: 'text-lg sm:text-2xl leading-loose sm:leading-[2.5rem]',
    xlarge: 'text-xl sm:text-3xl leading-loose sm:leading-[3rem]',
  };

  return (
    <div
      className={`space-y-6 pb-28 animate-in fade-in transition-all ${
        settings.concentrationMode
          ? 'fixed inset-0 z-50 bg-slate-950 text-white overflow-y-auto p-4 sm:p-10 pb-36'
          : ''
      }`}
      dir="rtl"
    >
      {/* Top Header & Reading Controls Toolbar */}
      {passage && (
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200/80 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-md bg-blue-600 text-white font-black text-xs">
                CEFR {passage.level}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {passage.wordCount} كلمة • {passage.sentences.length} جملة
              </span>
              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                محفوظ محلياً (IndexedDB)
              </span>
              {timerRemainingSeconds !== null && (
                <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 text-xs font-bold flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>مؤقت الجلسة: {formatTimer(timerRemainingSeconds)}</span>
                </span>
              )}
            </div>
            <h1 className="font-german text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mt-1" dir="ltr">
              {passage.title}
            </h1>
            <p className="font-german text-xs text-slate-400 mt-0.5" dir="ltr">
              {passage.authorInfo}
            </p>
          </div>

          {/* Action Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Toggle Tab */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
              <button
                onClick={() => switchTab('reading')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'reading'
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                استماع وقراءة
              </button>
              <button
                onClick={() => switchTab('import')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                  activeTab === 'import'
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>استيراد نص</span>
              </button>
            </div>

            {/* Font size picker */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
              <button
                onClick={() => setFontSize('normal')}
                className={`px-2 py-1 text-xs rounded font-bold ${
                  fontSize === 'normal' ? 'bg-white dark:bg-slate-900 text-blue-600' : 'text-slate-500'
                }`}
                title="خط عادي"
              >
                A
              </button>
              <button
                onClick={() => setFontSize('large')}
                className={`px-2.5 py-1 text-sm rounded font-bold ${
                  fontSize === 'large' ? 'bg-white dark:bg-slate-900 text-blue-600' : 'text-slate-500'
                }`}
                title="خط كبير"
              >
                A+
              </button>
              <button
                onClick={() => setFontSize('xlarge')}
                className={`px-3 py-1 text-base rounded font-bold ${
                  fontSize === 'xlarge' ? 'bg-white dark:bg-slate-900 text-blue-600' : 'text-slate-500'
                }`}
                title="خط كبير جداً"
              >
                A++
              </button>
            </div>

            {/* Toggle Arabic summary */}
            {passage.arabicSummary && (
              <button
                onClick={() => setShowArabicTranslation(!showArabicTranslation)}
                className={`p-2 rounded-xl border text-xs font-medium transition-colors ${
                  showArabicTranslation
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                    : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'
                }`}
                title={showArabicTranslation ? 'إخفاء الترجمة العربية' : 'إظهار الترجمة العربية'}
              >
                {showArabicTranslation ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>
            )}

            {/* Concentration Mode Button */}
            <button
              onClick={() => onUpdateSettings({ concentrationMode: !settings.concentrationMode })}
              className={`px-3 py-2 rounded-xl border text-xs font-bold transition-all flex items-center gap-1.5 ${
                settings.concentrationMode
                  ? 'bg-indigo-600 text-white border-indigo-700 shadow-sm'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
              }`}
              title="وضع التركيز (Konzentrationsmodus)"
            >
              {settings.concentrationMode ? (
                <>
                  <Minimize2 className="w-4 h-4" />
                  <span>إنهاء وضع التركيز</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-4 h-4" />
                  <span className="hidden sm:inline">وضع التركيز</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Inline Audio Error Alert inside ReaderView (visible in Concentration Mode too) */}
      {playbackState === 'error' && audioError && (
        <div
          className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs flex flex-wrap items-center justify-between gap-3"
          role="alert"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>
              <strong>تعذر تشغيل صوت ElevenLabs:</strong> {audioError}
            </span>
          </div>
          <button
            onClick={() => audioEngine.retryLast()}
            className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>إعادة المحاولة</span>
          </button>
        </div>
      )}

      {importNotice && (
        <div
          role="status"
          className={`p-3 rounded-xl text-xs flex items-start justify-between gap-3 border ${
            importNotice.kind === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
              : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
          }`}
        >
          <span>{importNotice.text}</span>
          <button
            type="button"
            onClick={() => setImportNotice(null)}
            className="shrink-0 font-bold opacity-70 hover:opacity-100"
            aria-label="إغلاق"
          >
            ✕
          </button>
        </div>
      )}

      {/* READING VIEW */}
      {activeTab === 'reading' && passage && (
        <div className="space-y-6">
          {/* Main Reading Card */}
          <div
            className={`rounded-3xl border transition-all p-6 sm:p-10 ${
              settings.concentrationMode
                ? 'bg-slate-900/90 border-slate-800 shadow-2xl max-w-4xl mx-auto'
                : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 shadow-xs'
            }`}
          >
            {/* Guide hint */}
            <div className="mb-6 p-3 rounded-xl bg-blue-50/70 dark:bg-slate-800/60 border border-blue-100 dark:border-slate-700 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
              <span className="flex items-center gap-1.5">
                <Info className="w-4 h-4 text-blue-600 shrink-0" />
                <span>
                  <strong>نصيحة:</strong> انقر على <strong>أي كلمة</strong> للاستماع لنطقها فقط عبر ElevenLabs ومعرفة معناها بالعربية. انقر على أيقونة الترجمة بجانب الجملة لمعرفة إعرابها.
                </span>
              </span>
              <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300 hidden md:block">
                القراءة الحالية: جملة بجملة بصوت ElevenLabs
              </span>
            </div>

            {/* German Text with Sentence-by-Sentence Synchronization & Word Click */}
            <div
              className={`font-german text-slate-900 dark:text-slate-100 font-medium ${fontSizeClasses[fontSize]}`}
              dir="ltr"
            >
              {passage.sentences.map((sentence, sIdx) => {
                const isActive = activeSentenceIndex === sIdx;
                const tokens = sentence.split(/(\s+|[.,!?;:„"“»«()]+)/g).filter(Boolean);

                return (
                  <span
                    key={sIdx}
                    ref={(el) => {
                      sentenceRefs.current[sIdx] = el;
                    }}
                    className={`inline rounded-xl px-1.5 py-1 mx-0.5 transition-all duration-300 relative group/sent ${
                      isActive
                        ? 'bg-blue-100/90 text-blue-950 dark:bg-blue-950/80 dark:text-blue-100 active-sentence-glow font-semibold ring-2 ring-blue-400/50'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    {/* Sentence Action badge */}
                    <span className="inline-flex items-center gap-1 opacity-85 sm:opacity-65 group-hover/sent:opacity-100 transition-opacity ml-1 mr-1 align-middle">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayFromSentence(sIdx);
                        }}
                        className="p-1 rounded bg-blue-600 text-white hover:bg-blue-700 text-[10px] shadow-xs inline-flex items-center"
                        title="تشغيل الصوت من هذه الجملة"
                      >
                        <Volume2 className="w-2.5 h-2.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSentenceClick(sentence);
                        }}
                        className="p-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 text-[10px] shadow-xs inline-flex items-center"
                        title="ترجمة وتحليل الجملة بالعربية"
                      >
                        <BookOpen className="w-2.5 h-2.5" />
                      </button>
                    </span>

                    {/* Words inside the sentence */}
                    {tokens.map((token, tIdx) => {
                      const isWord = /[a-zA-ZäöüÄÖÜß]/.test(token);
                      if (!isWord) {
                        return <span key={tIdx}>{token}</span>;
                      }

                      return (
                        <button
                          key={tIdx}
                          type="button"
                          onClick={(e) => handleWordClick(e, token, sentence)}
                          className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline underline-offset-4 decoration-blue-500/50 transition-colors inline cursor-pointer select-text focus:outline-none"
                          title="انقر لنطق الكلمة فقط وترجمتها بالعربية"
                        >
                          {token}
                        </button>
                      );
                    })}
                    {' '}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Arabic Translation Block (if enabled) */}
          {showArabicTranslation && passage.arabicSummary && (
            <div className="bg-indigo-50/50 dark:bg-slate-900 p-6 rounded-3xl border border-indigo-100 dark:border-slate-800 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-700 dark:text-indigo-400 flex items-center gap-1.5">
                  <BookOpen className="w-4 h-4" />
                  الترجمة العربية للنص الكامل:
                </span>
                <span className="text-[11px] text-slate-400">فهم واستيعاب المضمون</span>
              </div>
              <p className="text-sm sm:text-base text-slate-700 dark:text-slate-200 leading-relaxed font-arabic">
                {passage.arabicSummary}
              </p>
            </div>
          )}

          {/* Key Vocabulary Snippet */}
          {passage.keyVocabulary && passage.keyVocabulary.length > 0 && (
            <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-blue-600" />
                المفردات المفتاحية لهذا النص:
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {passage.keyVocabulary.map((kv, idx) => (
                  <button
                    key={idx}
                    onClick={(e) => handleWordClick(e, kv.german, passage.germanText)}
                    className="p-3 text-right bg-slate-50 hover:bg-blue-50/70 dark:bg-slate-800 dark:hover:bg-slate-750 border border-slate-200/80 dark:border-slate-700 rounded-xl transition-colors group flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <span className="font-german font-bold text-xs text-slate-900 dark:text-white group-hover:text-blue-600 block truncate" dir="ltr">
                        {kv.article ? `${kv.article} ` : ''}
                        {kv.german}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5 truncate">
                        {kv.arabic}
                      </span>
                    </div>
                    <Volume2 className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5 opacity-75 group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* IMPORT / UPLOAD TAB */}
      {activeTab === 'import' && (
        <div className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              استيراد أو لصق نصوص ألمانية خارجية
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              يدعم ملفات TXT و PDF و DOCX أو لصق المقالات والمحادثات وحفظها محلياً في المتصفح لقراءتها بصوت ElevenLabs.
            </p>
          </div>

          {importError && (
            <div className="p-3 bg-rose-50 text-rose-700 rounded-xl text-xs">{importError}</div>
          )}

          {/* File Upload Box */}
          <div
            onClick={() => !isImporting && fileInputRef.current?.click()}
            className="p-8 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-3xl text-center hover:border-blue-500 hover:bg-blue-50/20 dark:hover:bg-slate-800/40 transition-all cursor-pointer space-y-3"
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".txt,.pdf,.docx"
              className="hidden"
            />
            <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 mx-auto flex items-center justify-center">
              <Upload className="w-6 h-6" />
            </div>
            <div>
              <span className="text-sm font-bold text-slate-800 dark:text-slate-200 block">
                {isImporting ? 'جارٍ استخراج النص...' : 'اضغط لرفع ملف ألماني (TXT / PDF / DOCX)'}
              </span>
              <span className="text-xs text-slate-400">يتم استخراج النصوص تلقائياً مع الحفاظ على الفقرات والتشكيل الألماني</span>
            </div>
          </div>

          <div className="relative text-center">
            <span className="bg-white dark:bg-slate-900 px-3 text-xs text-slate-400 font-bold relative z-10">
              أو الصق النص يدوياً
            </span>
            <div className="absolute top-1/2 left-0 right-0 h-px bg-slate-200 dark:bg-slate-800 -z-0" />
          </div>

          {/* Manual Text Input */}
          <div className="space-y-3">
            <input
              type="text"
              value={inputTitle}
              onChange={(e) => setInputTitle(e.target.value)}
              placeholder="عنوان النص (اختياري)..."
              className="w-full px-4 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
            />
            <textarea
              rows={6}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="الصق النص الألماني هنا..."
              className="w-full p-4 text-sm font-german bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 leading-relaxed"
              dir="ltr"
            />
            <button
              onClick={handleManualImport}
              disabled={!inputText.trim()}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-bold text-xs shadow-xs transition-all"
            >
              استيراد وقراءة في المشغل الآن
            </button>
          </div>
        </div>
      )}

      {/* Interactive Word Dictionary Modal */}
      {selectedWord && passage && (
        <WordDictionaryModal
          word={selectedWord}
          sentenceContext={selectedSentenceContext}
          level={passage.level}
          sourceTitle={passage.title}
          isOpen={isWordModalOpen}
          onClose={() => setIsWordModalOpen(false)}
        />
      )}

      {/* Sentence Explanation Modal */}
      {selectedSentenceForModal && passage && (
        <SentenceModal
          sentence={selectedSentenceForModal}
          context={passage.germanText}
          isOpen={isSentenceModalOpen}
          onClose={() => setIsSentenceModalOpen(false)}
          onWordClick={(w) => {
            setSelectedWord(w);
            setSelectedSentenceContext(selectedSentenceForModal || '');
            setIsWordModalOpen(true);
          }}
        />
      )}
    </div>
  );
};
