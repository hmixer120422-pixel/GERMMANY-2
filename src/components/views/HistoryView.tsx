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
} from 'lucide-react';
import { GermanTextPassage, SupabaseStorageFileItem } from '../../types';
import { deleteTextPassage, updateTextPassage } from '../../services/storage';
import {
  deleteFileFromSupabaseStorage,
  downloadFileFromSupabaseStorage,
  listUserFilesFromSupabaseStorage,
  uploadFileToSupabaseStorage,
} from '../../services/supabaseSync';
import { formatBytes } from '../../utils/audioHash';

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
  const [uploadingFile, setUploadingFile] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const cloudFileInputRef = useRef<HTMLInputElement | null>(null);

  const loadCloudFiles = useCallback(async () => {
    if (!supabaseUserEmail) {
      setCloudFiles([]);
      return;
    }
    setLoadingFiles(true);
    setStorageError(null);
    try {
      const files = await listUserFilesFromSupabaseStorage();
      setCloudFiles(files);
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

  const handleDirectCloudUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    setStorageError(null);
    try {
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
    } catch (err: any) {
      setStorageError(err?.message || 'تعذر رفع الملف إلى Supabase Storage.');
    } finally {
      setUploadingFile(false);
      if (cloudFileInputRef.current) cloudFileInputRef.current.value = '';
    }
  };

  const handleDeleteCloudFile = async (path: string) => {
    setStorageError(null);
    try {
      await deleteFileFromSupabaseStorage(path);
      await loadCloudFiles();
    } catch (err: any) {
      setStorageError(err?.message || 'تعذر حذف الملف.');
    }
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
                    {passage.storagePath && (
                      <button
                        onClick={(e) => handleDownloadPassageFile(e, passage)}
                        className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
                        title="تحميل المستند الأصلي من Supabase Storage"
                      >
                        <Download className="w-4 h-4" />
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
      {/* Private Supabase Storage (`german-learning`) Files */}
      {supabaseUserEmail && (
        <section className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Cloud className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  ملفاتي السحابية الخاصة (Supabase Storage: german-learning)
                </h2>
                <p className="text-xs text-slate-400">
                  رفع وتحميل وحذف ملفات TXT / PDF / DOCX المحفوظة في مجلدك الخاص المحمي بـ RLS
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={cloudFileInputRef}
                type="file"
                accept=".txt,.pdf,.docx"
                onChange={handleDirectCloudUpload}
                className="hidden"
              />
              <button
                onClick={() => cloudFileInputRef.current?.click()}
                disabled={uploadingFile}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{uploadingFile ? 'جارٍ الرفع...' : 'رفع ملف للسحابة'}</span>
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
          </div>

          {storageError && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{storageError}</span>
            </div>
          )}

          {cloudFiles.length === 0 ? (
            <p className="text-xs text-slate-400">
              لا توجد ملفات مرفوعة في سحابة <code>german-learning</code> حتى الآن. عند استيراد أي ملف TXT / PDF / DOCX سيتم رفعه تلقائياً هنا.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-2xl border border-slate-100 dark:border-slate-800">
              {cloudFiles.map((file) => (
                <div
                  key={file.path}
                  className="p-3 flex items-center justify-between gap-3 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-german font-semibold text-slate-800 dark:text-slate-100 truncate" dir="ltr">
                        {file.name}
                      </p>
                      <span className="text-[11px] text-slate-400">
                        {file.size > 0 ? formatBytes(file.size) : 'ملف سحابي'}
                        {file.createdAt ? ` • ${new Date(file.createdAt).toLocaleDateString('ar-EG')}` : ''}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
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
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
