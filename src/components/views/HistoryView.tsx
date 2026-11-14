import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  History,
  BookOpen,
  Search,
  Trash2,
  Star,
  ArrowLeft,
  Upload,
  Cloud,
  Download,
  RefreshCw,
  FileText,
  AlertCircle,
  CheckCircle2,
  X,
  Volume2,
  Play,
  Pause,
  RotateCcw,
  Copy,
} from 'lucide-react';
import { GermanTextPassage, SupabaseStorageFileItem } from '../../types';
import {
  addTextPassage,
  deleteTextPassage,
  updateTextPassage,
} from '../../services/storage';
import {
  deduplicateSupabaseAudioStorage,
  deleteFileFromSupabaseStorage,
  downloadFileFromSupabaseStorage,
  ensureSupabaseAudioDeduplicatedOnce,
  fetchPlayableAudioFromSupabaseStorage,
  isBucketMimeConfigError,
  listUserFilesFromSupabaseStorage,
  SUPABASE_AUDIO_BUCKET_SQL,
  uploadFileToSupabaseStorage,
  uploadTextManuallyToSupabase,
} from '../../services/supabaseSync';
import { formatBytes, splitGermanSentences } from '../../utils/audioHash';
import { getFileExtension, isAudioFileNameOrMime } from '../../utils/audioMime';

interface HistoryViewProps {
  passages: GermanTextPassage[];
  onSelectPassage: (passage: GermanTextPassage) => void;
  onRefreshPassages: () => void;
  onNavigateToImport: () => void;
  supabaseUserEmail?: string | null;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  passages,
  onSelectPassage,
  onRefreshPassages,
  onNavigateToImport,
  supabaseUserEmail,
}) => {
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const [cloudFiles, setCloudFiles] = useState<SupabaseStorageFileItem[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [dedupingAudio, setDedupingAudio] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadingPassageId, setUploadingPassageId] = useState<string | null>(null);
  const [showManualCloudTextForm, setShowManualCloudTextForm] = useState(false);
  const [manualCloudTitle, setManualCloudTitle] = useState('');
  const [manualCloudText, setManualCloudText] = useState('');
  const [saveManualCloudLocally, setSaveManualCloudLocally] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [copiedAudioSql, setCopiedAudioSql] = useState(false);
  const [playingAudioPath, setPlayingAudioPath] = useState<string | null>(null);
  const [audioPlayStatus, setAudioPlayStatus] = useState<'idle' | 'loading' | 'playing' | 'paused'>('idle');
  const [audioCurrentSec, setAudioCurrentSec] = useState(0);
  const [audioDurationSec, setAudioDurationSec] = useState(0);
  const cloudFileInputRef = useRef<HTMLInputElement | null>(null);
  const cloudAudioRef = useRef<HTMLAudioElement | null>(null);
  const cloudAudioUrlRef = useRef<string | null>(null);

  const stopCloudAudio = useCallback(() => {
    if (cloudAudioRef.current) {
      cloudAudioRef.current.pause();
      cloudAudioRef.current.onended = null;
      cloudAudioRef.current.onerror = null;
      cloudAudioRef.current.ontimeupdate = null;
      cloudAudioRef.current.onloadedmetadata = null;
      cloudAudioRef.current = null;
    }
    if (cloudAudioUrlRef.current) {
      URL.revokeObjectURL(cloudAudioUrlRef.current);
      cloudAudioUrlRef.current = null;
    }
    setPlayingAudioPath(null);
    setAudioPlayStatus('idle');
    setAudioCurrentSec(0);
    setAudioDurationSec(0);
  }, []);

  useEffect(() => {
    return () => {
      stopCloudAudio();
    };
  }, [stopCloudAudio]);

  const loadCloudFiles = useCallback(async () => {
    if (!supabaseUserEmail) {
      setCloudFiles([]);
      return;
    }
    setLoadingFiles(true);
    setStorageError(null);
    try {
      const dedupeRes = await ensureSupabaseAudioDeduplicatedOnce();
      const files = await listUserFilesFromSupabaseStorage();
      setCloudFiles(files);
      if (dedupeRes && dedupeRes.deletedCount > 0) {
        setUploadSuccess(
          `✓ تم تنظيف ${dedupeRes.deletedCount} كلمة صوتية مكررة في Supabase Storage والإبقاء على نسخة واحدة لكل كلمة.`
        );
      }
    } catch (err: any) {
      setStorageError(err?.message || 'تعذر جلب ملفات Supabase Storage.');
    } finally {
      setLoadingFiles(false);
    }
  }, [supabaseUserEmail]);

  useEffect(() => {
    loadCloudFiles();
  }, [loadCloudFiles]);

  const filtered = passages.filter((p) => {
    const matchesSearch =
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.topic.toLowerCase().includes(search.toLowerCase()) ||
      p.germanText.toLowerCase().includes(search.toLowerCase());
    const matchesLevel = levelFilter === 'all' || p.level === levelFilter;
    const matchesFav = !showFavoritesOnly || p.isFavorite;
    return matchesSearch && matchesLevel && matchesFav;
  });

  const toggleFavorite = (e: React.MouseEvent, passage: GermanTextPassage) => {
    e.stopPropagation();
    updateTextPassage({ ...passage, isFavorite: !passage.isFavorite });
    onRefreshPassages();
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteTextPassage(id);
    onRefreshPassages();
    if (supabaseUserEmail) {
      setTimeout(loadCloudFiles, 500);
    }
  };

  const handleDownloadPassageFile = async (e: React.MouseEvent, passage: GermanTextPassage) => {
    e.stopPropagation();
    if (!passage.storagePath) return;
    setStorageError(null);
    try {
      await downloadFileFromSupabaseStorage(passage.storagePath, passage.fileName || passage.title);
    } catch (err: any) {
      setStorageError(err?.message || 'تعذر تحميل الملف.');
    }
  };

  const handleManualUploadPassageToSupabase = async (
    e: React.MouseEvent,
    passage: GermanTextPassage
  ) => {
    e.stopPropagation();
    setUploadingPassageId(passage.id);
    setStorageError(null);
    setUploadSuccess(null);
    try {
      const uploaded = await uploadTextManuallyToSupabase({
        title: passage.title,
        content: passage.germanText,
        fileName: passage.fileName || `${passage.title}.txt`,
        passage,
      });
      updateTextPassage({
        ...passage,
        storagePath: uploaded.storagePath,
        fileName: uploaded.fileName,
        fileSize: uploaded.fileSize,
        mimeType: uploaded.mimeType,
      });
      onRefreshPassages();
      await loadCloudFiles();
      setUploadSuccess(
        `✓ تم رفع النص «${passage.title}» (${formatBytes(uploaded.fileSize)}) يدوياً إلى Supabase بنجاح.`
      );
    } catch (err: any) {
      setStorageError(err?.message || `فشل رفع النص «${passage.title}» إلى Supabase.`);
    } finally {
      setUploadingPassageId(null);
    }
  };

  const handleManualCloudTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStorageError(null);
    setUploadSuccess(null);

    const content = manualCloudText.trim();
    const title = manualCloudTitle.trim() || 'manual_german_text';
    if (!content) {
      setStorageError('يرجى إدخال نص ألماني لرفعه إلى Supabase.');
      return;
    }

    setUploadingFile(true);
    try {
      const uploaded = await uploadTextManuallyToSupabase({
        title,
        content,
        fileName: `${title}.txt`,
      });

      if (saveManualCloudLocally) {
        const sentences = splitGermanSentences(content);
        const newPassage: GermanTextPassage = {
          id: 'cloud-manual-' + Date.now(),
          title,
          authorInfo: 'نص مرفوع يدوياً إلى Supabase',
          level: 'A2',
          germanText: content,
          sentences: sentences.length > 0 ? sentences : [content],
          arabicSummary: '',
          keyVocabulary: [],
          wordCount: content.split(/\s+/).filter(Boolean).length,
          style: 'Custom Text',
          topic: 'رفع يدوي للسحابة',
          storagePath: uploaded.storagePath,
          fileName: uploaded.fileName,
          fileSize: uploaded.fileSize,
          mimeType: uploaded.mimeType,
          createdAt: new Date().toISOString(),
        };
        addTextPassage(newPassage);
        onRefreshPassages();
      }

      await loadCloudFiles();
      setUploadSuccess(
        `✓ تم رفع النص «${uploaded.fileName}» (${formatBytes(uploaded.fileSize)}) يدوياً إلى حاوية german-learning في Supabase بنجاح.`
      );
      setManualCloudTitle('');
      setManualCloudText('');
      setShowManualCloudTextForm(false);
    } catch (err: any) {
      setStorageError(err?.message || 'فشل رفع النص يدوياً إلى Supabase.');
    } finally {
      setUploadingFile(false);
    }
  };

  const handleDirectCloudUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    setStorageError(null);
    setUploadSuccess(null);
    try {
      if (file.size === 0) {
        throw new Error('الملف المختار فارغ.');
      }
      if (file.size > 25 * 1024 * 1024) {
        throw new Error(`حجم الملف (${formatBytes(file.size)}) يتجاوز الحد الأقصى 25 MB.`);
      }
      const uploaded = await uploadFileToSupabaseStorage(file);
      if (!uploaded) {
        throw new Error(
          'تعذر الرفع: سجّل الدخول بحساب Supabase أولاً، وتأكد من ضبط SUPABASE_URL و SUPABASE_PUBLISHABLE_KEY.'
        );
      }
      await loadCloudFiles();
      if (uploaded.skippedExisting) {
        setUploadSuccess(
          `✓ الملف الصوتي «${uploaded.fileName}» محفوظ مسبقاً في السحابة — تم تخطي إعادة الرفع لتجنب التكرار.`
        );
      } else {
        setUploadSuccess(`✓ تم رفع «${uploaded.fileName}» (${formatBytes(uploaded.fileSize)}) إلى السحابة بنجاح.`);
      }
    } catch (err: any) {
      setStorageError(err?.message || 'تعذر رفع الملف إلى Supabase Storage.');
    } finally {
      setUploadingFile(false);
      if (cloudFileInputRef.current) cloudFileInputRef.current.value = '';
    }
  };

  const handleDeduplicateCloudAudio = async () => {
    setDedupingAudio(true);
    setStorageError(null);
    setUploadSuccess(null);
    try {
      const res = await deduplicateSupabaseAudioStorage();
      await loadCloudFiles();
      if (res.deletedCount > 0) {
        setUploadSuccess(
          `✓ تم فحص ${res.totalScanned} ملف صوتي وحذف ${res.deletedCount} ملف مكرر مع الإبقاء على نسخة واحدة لكل كلمة (${res.keptCount} كلمة).`
        );
      } else {
        setUploadSuccess(
          `✓ تم فحص ${res.totalScanned} ملف صوتي — لا توجد كلمات مكررة في Supabase Storage.`
        );
      }
    } catch (err: any) {
      setStorageError(err?.message || 'تعذر فحص وحذف الملفات الصوتية المكررة.');
    } finally {
      setDedupingAudio(false);
    }
  };

  const handleDeleteCloudFile = async (path: string) => {
    setStorageError(null);
    try {
      if (playingAudioPath === path) {
        stopCloudAudio();
      }
      await deleteFileFromSupabaseStorage(path);
      await loadCloudFiles();
    } catch (err: any) {
      setStorageError(err?.message || 'تعذر حذف الملف.');
    }
  };

  const handlePlayPauseCloudAudio = async (file: SupabaseStorageFileItem) => {
    setStorageError(null);

    if (playingAudioPath === file.path && cloudAudioRef.current) {
      if (audioPlayStatus === 'playing') {
        cloudAudioRef.current.pause();
        setAudioPlayStatus('paused');
      } else if (audioPlayStatus === 'paused') {
        try {
          await cloudAudioRef.current.play();
          setAudioPlayStatus('playing');
        } catch (err: any) {
          setStorageError(err?.message || 'تعذر استئناف تشغيل الصوت.');
        }
      }
      return;
    }

    stopCloudAudio();
    setPlayingAudioPath(file.path);
    setAudioPlayStatus('loading');

    try {
      const { blob, mimeType } = await fetchPlayableAudioFromSupabaseStorage(
        file.path,
        file.name,
        file.mimeType
      );
      const url = URL.createObjectURL(blob);
      const audioEl = new Audio(url);
      cloudAudioUrlRef.current = url;
      cloudAudioRef.current = audioEl;

      audioEl.onloadedmetadata = () => {
        if (Number.isFinite(audioEl.duration)) {
          setAudioDurationSec(audioEl.duration);
        }
      };
      audioEl.ontimeupdate = () => {
        setAudioCurrentSec(audioEl.currentTime || 0);
      };
      audioEl.onended = () => {
        setAudioPlayStatus('paused');
        setAudioCurrentSec(audioEl.duration || 0);
      };
      audioEl.onerror = () => {
        setStorageError(
          `فشل المتصفح في فك ترميز وتشغيل الملف الصوتي «${file.name}» (${mimeType}).`
        );
        stopCloudAudio();
      };

      await audioEl.play();
      setAudioPlayStatus('playing');
    } catch (err: any) {
      setStorageError(err?.message || `تعذر تشغيل الملف الصوتي «${file.name}».`);
      stopCloudAudio();
    }
  };

  const handleReplayCloudAudio = async (file: SupabaseStorageFileItem) => {
    setStorageError(null);
    if (playingAudioPath === file.path && cloudAudioRef.current) {
      try {
        cloudAudioRef.current.currentTime = 0;
        setAudioCurrentSec(0);
        await cloudAudioRef.current.play();
        setAudioPlayStatus('playing');
        return;
      } catch (err: any) {
        setStorageError(err?.message || 'تعذر إعادة تشغيل الملف الصوتي.');
      }
    }
    await handlePlayPauseCloudAudio(file);
  };

  const handleCopyBucketSql = () => {
    navigator.clipboard?.writeText(SUPABASE_AUDIO_BUCKET_SQL).catch(() => {});
    setCopiedAudioSql(true);
    setTimeout(() => setCopiedAudioSql(false), 2500);
  };

  return (
    <div className="space-y-8 animate-in fade-in" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80 dark:border-slate-800">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-xs font-bold mb-1">
            <History className="w-3.5 h-3.5" />
            <span>مكتبة النصوص وسجل الاستماع</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
            سجل القراءة ومكتبتي الشخصية
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            جميع النصوص والمستندات الألمانية التي قمت بإدخالها أو استيرادها، مع حفظ آخر موضع قراءة.
          </p>
        </div>

        <button
          onClick={onNavigateToImport}
          className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs flex items-center gap-1.5 transition-all self-start sm:self-auto"
        >
          <Upload className="w-4 h-4" />
          <span>كتابة / استيراد نص</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالعنوان أو الموضوع أو الكلمات في النص..."
            className="w-full pr-9 pl-4 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Level Filter */}
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200"
          >
            <option value="all">كل المستويات ({passages.length})</option>
            <option value="A1">مستوى A1</option>
            <option value="A2">مستوى A2</option>
            <option value="B1">مستوى B1</option>
            <option value="B2">مستوى B2</option>
            <option value="C1">مستوى C1</option>
            <option value="C2">مستوى C2</option>
          </select>

          {/* Favorite Toggle */}
          <button
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors flex items-center gap-1.5 ${
              showFavoritesOnly
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${showFavoritesOnly ? 'fill-current' : ''}`} />
            <span>المفضلة فقط</span>
          </button>
        </div>
      </div>

      {/* Passages Grid */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center space-y-3 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 mx-auto flex items-center justify-center">
            <BookOpen className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-slate-700 dark:text-slate-200 text-base">لا توجد نصوص تطابق البحث</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            يمكنك كتابة نصوص ألمانية يدوياً أو استيراد ملفات TXT و PDF و DOCX لقراءتها في أي وقت.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((passage) => (
            <div
              key={passage.id}
              onClick={() => onSelectPassage(passage)}
              className="group bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-0.5 text-xs font-black rounded-md bg-blue-600 text-white">
                    {passage.level}
                  </span>
                  <div className="flex items-center gap-1">
                    {passage.storagePath ? (
                      <button
                        onClick={(e) => handleDownloadPassageFile(e, passage)}
                        className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
                        title="تحميل المستند الأصلي من Supabase Storage"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => handleManualUploadPassageToSupabase(e, passage)}
                        disabled={uploadingPassageId === passage.id}
                        className="p-1.5 rounded-lg text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/40 disabled:opacity-40 transition-colors"
                        title="رفع هذا النص يدوياً إلى Supabase"
                      >
                        <Upload className={`w-4 h-4 ${uploadingPassageId === passage.id ? 'animate-pulse' : ''}`} />
                      </button>
                    )}
                    <button
                      onClick={(e) => toggleFavorite(e, passage)}
                      className={`p-1.5 rounded-lg transition-colors ${
                        passage.isFavorite
                          ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                          : 'text-slate-300 hover:text-slate-500'
                      }`}
                      title={passage.isFavorite ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
                    >
                      <Star className={`w-4 h-4 ${passage.isFavorite ? 'fill-current' : ''}`} />
                    </button>
                    <button
                      onClick={(e) => handleDelete(e, passage.id)}
                      className="p-1.5 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                      title="حذف النص"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="font-german font-bold text-slate-900 dark:text-white text-base group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-1" dir="ltr">
                    {passage.title}
                  </h3>
                  <p className="font-german text-xs text-blue-700 dark:text-blue-400 font-medium mt-0.5" dir="ltr">
                    {passage.authorInfo}
                  </p>
                </div>

                <p className="font-german text-xs text-slate-600 dark:text-slate-300 line-clamp-3 leading-relaxed" dir="ltr">
                  {passage.germanText}
                </p>

                {passage.arabicSummary && (
                  <p className="text-xs text-slate-400 font-arabic line-clamp-1">
                    {passage.arabicSummary}
                  </p>
                )}
              </div>

              <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                <span className="text-[11px] text-slate-400">
                  {passage.wordCount} كلمة • {passage.sentences.length} جمل
                </span>
                <span className="font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1 group-hover:translate-x-[-3px] transition-transform">
                  استماع الآن
                  <ArrowLeft className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {/* Private Supabase Storage (`german-learning`) Files & Manual Cloud Upload */}
      <section className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                ملفاتي السحابية الخاصة والرفع اليدوي (Supabase: german-learning)
              </h2>
              <p className="text-xs text-slate-400">
                رفع ملفات أو نصوص يدوياً وتحميلها وحذفها في مجلدك الخاص المحمي بـ RLS
              </p>
            </div>
          </div>

          {supabaseUserEmail && (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={cloudFileInputRef}
                type="file"
                accept=".txt,.pdf,.docx,.csv,.mp3,.wav,.m4a,.ogg,.webm,.aac,.flac,audio/*"
                onChange={handleDirectCloudUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => {
                  setShowManualCloudTextForm((prev) => !prev);
                  setStorageError(null);
                  setUploadSuccess(null);
                }}
                className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>إدخال نص ورفعه يدوياً</span>
              </button>
              <button
                onClick={() => cloudFileInputRef.current?.click()}
                disabled={uploadingFile}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{uploadingFile ? 'جارٍ الرفع...' : 'رفع ملف للسحابة'}</span>
              </button>
              <button
                type="button"
                onClick={handleDeduplicateCloudAudio}
                disabled={dedupingAudio || loadingFiles}
                className="px-3 py-1.5 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
                title="فحص وحذف الكلمات الصوتية المكررة في Supabase مع الإبقاء على نسخة واحدة لكل كلمة"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{dedupingAudio ? 'جارٍ التنظيف...' : 'مسح المكررات'}</span>
              </button>
              <button
                onClick={loadCloudFiles}
                disabled={loadingFiles}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                title="تحديث قائمة الملفات"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingFiles ? 'animate-spin' : ''}`} />
              </button>
            </div>
          )}
        </div>

        {uploadSuccess && (
          <div
            role="status"
            className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-bold text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-2"
          >
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{uploadSuccess}</span>
            </span>
            <button
              type="button"
              onClick={() => setUploadSuccess(null)}
              className="opacity-70 hover:opacity-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {storageError && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs font-bold text-rose-700 dark:text-rose-300 space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{storageError}</span>
              </span>
              <button
                type="button"
                onClick={() => setStorageError(null)}
                className="opacity-70 hover:opacity-100 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {isBucketMimeConfigError(storageError) && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-rose-200/70 dark:border-rose-800/70 font-normal">
                <span className="text-[11px]">
                  لتفعيل صيغ الصوت (MP3 / WAV / M4A / OGG / WEBM / AAC / FLAC) على حاوية <code>german-learning</code>:
                </span>
                <button
                  type="button"
                  onClick={handleCopyBucketSql}
                  className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 font-bold text-[11px] flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  <span>{copiedAudioSql ? 'تم نسخ SQL!' : 'نسخ SQL تحديث صيغ الصوت'}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {!supabaseUserEmail ? (
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
            سجّل الدخول بحساب Supabase (من الشريط العلوي أو الإعدادات) لتفعيل الرفع اليدوي للملفات والنصوص إلى حاوية <code>german-learning</code>.
          </div>
        ) : (
          <>
            {showManualCloudTextForm && (
              <form
                onSubmit={handleManualCloudTextSubmit}
                className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-emerald-200 dark:border-emerald-800 space-y-3 animate-in fade-in"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                    إنشاء نص / قائمة كلمات ورفعها يدوياً إلى Supabase Storage (.txt)
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowManualCloudTextForm(false)}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <input
                  type="text"
                  value={manualCloudTitle}
                  onChange={(e) => setManualCloudTitle(e.target.value)}
                  placeholder="اسم الملف أو العنوان (مثال: my_german_notes)"
                  className="w-full px-3.5 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                />
                <textarea
                  rows={4}
                  value={manualCloudText}
                  onChange={(e) => setManualCloudText(e.target.value)}
                  placeholder="اكتب أو الصق النص الألماني الذي تريد رفعه إلى السحابة يدوياً..."
                  dir="auto"
                  className="w-full p-3 text-xs font-german bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={saveManualCloudLocally}
                      onChange={(e) => setSaveManualCloudLocally(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-emerald-600"
                    />
                    <span>إضافة نسخة أيضاً إلى مكتبة القراءة المحلية</span>
                  </label>
                  <button
                    type="submit"
                    disabled={uploadingFile}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadingFile ? 'جارٍ الرفع...' : 'رفع إلى Supabase الآن'}</span>
                  </button>
                </div>
              </form>
            )}

            {cloudFiles.length === 0 ? (
              <p className="text-xs text-slate-400">
                لا توجد ملفات مرفوعة في سحابة <code>german-learning</code> حتى الآن. يمكنك الضغط على «رفع ملف للسحابة» أو «إدخال نص ورفعه يدوياً».
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-2xl border border-slate-100 dark:border-slate-800">
                {cloudFiles.map((file) => {
                  const isAudioFile =
                    file.path.includes('/audio/') || isAudioFileNameOrMime(file.name, file.mimeType);
                  const extLabel = getFileExtension(file.name).toUpperCase();
                  const isCurrentAudio = playingAudioPath === file.path;
                  const isPlayingThis = isCurrentAudio && audioPlayStatus === 'playing';
                  const isLoadingThis = isCurrentAudio && audioPlayStatus === 'loading';
                  const isPausedThis = isCurrentAudio && audioPlayStatus === 'paused';
                  return (
                  <div
                    key={file.path}
                    className="p-3 flex flex-wrap items-center justify-between gap-3 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {isAudioFile ? (
                        <Volume2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : (
                        <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-german font-semibold text-slate-800 dark:text-slate-100 truncate" dir="ltr">
                            {file.name}
                          </p>
                          {isAudioFile && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 text-[10px] font-bold shrink-0">
                              {extLabel ? `صوت ${extLabel}` : 'ملف صوتي'}
                            </span>
                          )}
                          {isCurrentAudio && (
                            <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-300">
                              {isLoadingThis
                                ? 'جارٍ التحميل...'
                                : isPlayingThis
                                ? `جارٍ التشغيل (${audioCurrentSec.toFixed(1)}ث${audioDurationSec > 0 ? ` / ${audioDurationSec.toFixed(1)}ث` : ''})`
                                : isPausedThis
                                ? 'متوقف مؤقتاً'
                                : ''}
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-400">
                          {file.size > 0 ? formatBytes(file.size) : 'ملف سحابي'}
                          {file.mimeType ? ` • ${file.mimeType}` : ''}
                          {file.createdAt ? ` • ${new Date(file.createdAt).toLocaleDateString('ar-EG')}` : ''}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isAudioFile && (
                        <>
                          <button
                            type="button"
                            onClick={() => handlePlayPauseCloudAudio(file)}
                            disabled={isLoadingThis}
                            className={`px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors ${
                              isPlayingThis
                                ? 'bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                                : 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                            }`}
                            title={
                              isPlayingThis
                                ? 'إيقاف مؤقت'
                                : isPausedThis
                                ? 'استئناف التشغيل'
                                : 'تشغيل الملف الصوتي مباشرة'
                            }
                          >
                            {isPlayingThis ? (
                              <>
                                <Pause className="w-3.5 h-3.5 fill-current" />
                                <span>إيقاف مؤقت</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5 fill-current" />
                                <span>{isPausedThis ? 'استئناف' : 'تشغيل'}</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReplayCloudAudio(file)}
                            disabled={isLoadingThis}
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                            title="إعادة تشغيل من البداية"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => downloadFileFromSupabaseStorage(file.path, file.name)}
                        className="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-bold flex items-center gap-1"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>تحميل</span>
                      </button>
                      <button
                        onClick={() => handleDeleteCloudFile(file.path)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        title="حذف الملف من السحابة"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};
