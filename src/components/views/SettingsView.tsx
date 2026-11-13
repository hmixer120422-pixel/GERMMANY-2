import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings,
  Volume2,
  Gauge,
  Layers,
  Check,
  Clock,
  Info,
  RotateCcw,
  HardDrive,
  Trash2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Play,
  Database,
  Cloud,
  LogIn,
  LogOut,
  RefreshCw,
  Copy,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { ElevenLabsVoiceOption, ReadingSettings, SupabaseSyncState, VoiceGender } from '../../types';
import {
  DEFAULT_ELEVENLABS_MODEL,
  fetchAvailableElevenLabsVoices,
  getAvailableElevenLabsVoices,
  onElevenLabsVoicesChange,
} from '../../services/elevenLabsVoices';
import { indexedDbCache, IndexedDbAudioRecord } from '../../services/indexedDbCache';
import {
  clearReadingHistoryInIndexedDb,
  getBrowserDataSummary,
} from '../../services/storage';
import { signOutFromSupabase } from '../../services/supabaseClient';
import { testSupabaseStorageConnection } from '../../services/supabaseSync';
import { formatBytes } from '../../utils/audioHash';

interface SettingsViewProps {
  settings: ReadingSettings;
  onUpdateSettings: (newSettings: Partial<ReadingSettings>) => void;
  onResetSettings: () => void;
  onDataCleared?: () => void;
  supabaseConfigured?: boolean;
  supabaseUserEmail?: string | null;
  supabaseSyncState?: SupabaseSyncState;
  supabaseLastSyncedAt?: string | null;
  supabaseSyncError?: string | null;
  onOpenAuthModal?: () => void;
  onSyncWithSupabase?: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onUpdateSettings,
  onResetSettings,
  onDataCleared,
  supabaseConfigured = false,
  supabaseUserEmail = null,
  supabaseSyncState = 'idle',
  supabaseLastSyncedAt = null,
  supabaseSyncError = null,
  onOpenAuthModal,
  onSyncWithSupabase,
}) => {
  const [genderTab, setGenderTab] = useState<VoiceGender>(settings.voiceGender || 'female');
  const [showSqlGuide, setShowSqlGuide] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  // Local IndexedDB cache & browser storage summary
  const [localStats, setLocalStats] = useState<{ count: number; totalBytes: number }>({
    count: 0,
    totalBytes: 0,
  });
  const [dataSummary, setDataSummary] = useState<{
    textsCount: number;
    vocabularyCount: number;
    historyCount: number;
  }>({ textsCount: 0, vocabularyCount: 0, historyCount: 0 });
  const [localEntries, setLocalEntries] = useState<Omit<IndexedDbAudioRecord, 'blob'>[]>([]);
  const [confirmClearLocal, setConfirmClearLocal] = useState(false);

  // ElevenLabs live voices & 4-step verification state
  const [availableVoices, setAvailableVoices] = useState<ElevenLabsVoiceOption[]>(
    () => getAvailableElevenLabsVoices().voices
  );
  const [voicesSource, setVoicesSource] = useState<'elevenlabs-live' | 'fallback'>(
    () => getAvailableElevenLabsVoices().source
  );
  const [voicesError, setVoicesError] = useState<string | null>(
    () => getAvailableElevenLabsVoices().error
  );
  const [elevenLabsConfigured, setElevenLabsConfigured] = useState<boolean | null>(null);
  const [testingAudio, setTestingAudio] = useState(false);
  const [testSteps, setTestSteps] = useState<{
    authVerified: boolean;
    voiceAvailable: boolean;
    audioGenerated: boolean;
    audioPlayed: boolean;
  } | null>(null);
  const [testResultMsg, setTestResultMsg] = useState<string | null>(null);
  const [testErrorMsg, setTestErrorMsg] = useState<string | null>(null);

  // Supabase Auth + Storage verification state
  const [testingSupabase, setTestingSupabase] = useState(false);
  const [supabaseTestMsg, setSupabaseTestMsg] = useState<string | null>(null);
  const [supabaseTestErr, setSupabaseTestErr] = useState<string | null>(null);

  const speeds = [0.5, 0.75, 0.85, 1.0, 1.15, 1.25, 1.5, 2.0];
  const timerOptions = [
    { value: 0, label: 'بدون مؤقت (مفتوح)' },
    { value: 10, label: '10 دقائق' },
    { value: 20, label: '20 دقيقة' },
    { value: 30, label: '30 دقيقة' },
    { value: 45, label: '45 دقيقة' },
    { value: 60, label: '60 دقيقة (جلسة كاملة)' },
  ];

  const loadLocalCache = useCallback(async () => {
    const [s, list, summary] = await Promise.all([
      indexedDbCache.getStats(),
      indexedDbCache.listEntries(),
      getBrowserDataSummary(),
    ]);
    setLocalStats(s);
    setLocalEntries(list);
    setDataSummary(summary);
  }, []);

  const checkServerStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/tts/status');
      if (res.ok) {
        const json = await res.json();
        setElevenLabsConfigured(Boolean(json?.data?.elevenLabsConfigured));
      }
    } catch {
      setElevenLabsConfigured(null);
    }
  }, []);

  useEffect(() => {
    loadLocalCache();
    checkServerStatus();
    const unsubVoices = onElevenLabsVoicesChange((snapshot) => {
      setAvailableVoices(snapshot.voices);
      setVoicesSource(snapshot.source);
      setVoicesError(snapshot.error);
      if (snapshot.elevenLabsConfigured) {
        setElevenLabsConfigured(true);
      }
    });
    fetchAvailableElevenLabsVoices();
    return () => {
      unsubVoices();
    };
  }, [loadLocalCache, checkServerStatus]);

  const handleClearLocalCache = async () => {
    await indexedDbCache.clearAll();
    setConfirmClearLocal(false);
    await loadLocalCache();
  };

  const handleDeleteLocalEntry = async (audioHash: string) => {
    await indexedDbCache.deleteAudio(audioHash);
    await loadLocalCache();
  };

  const handleClearHistory = async () => {
    await clearReadingHistoryInIndexedDb();
    await loadLocalCache();
    onDataCleared?.();
  };

  const verifyRealAudioPlayback = (base64Mp3: string): Promise<number> => {
    return new Promise((resolve, reject) => {
      const byteString = atob(base64Mp3);
      const bytes = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i++) {
        bytes[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audioEl = new Audio(url);
      let started = false;

      const cleanup = () => {
        audioEl.onplaying = null;
        audioEl.onended = null;
        audioEl.onerror = null;
        URL.revokeObjectURL(url);
      };

      audioEl.onplaying = () => {
        started = true;
      };
      audioEl.onended = () => {
        const dur = Number.isFinite(audioEl.duration) ? audioEl.duration : 0;
        cleanup();
        if (!started && dur <= 0) {
          reject(new Error('لم يبدأ تشغيل الملف الصوتي فعلياً في المتصفح.'));
        } else {
          resolve(dur);
        }
      };
      audioEl.onerror = () => {
        cleanup();
        reject(new Error('فشل المتصفح في فك ترميز وتشغيل ملف MP3 المُعاد من ElevenLabs.'));
      };

      audioEl.play().catch((playErr: any) => {
        cleanup();
        reject(
          new Error(
            playErr?.name === 'NotAllowedError'
              ? 'حظر المتصفح التشغيل التلقائي للصوت. يرجى السماح بالصوت والمحاولة مجدداً.'
              : playErr?.message || 'تعذر تشغيل الصوت المُولَّد من ElevenLabs.'
          )
        );
      });
    });
  };

  const handleTestElevenLabs = async () => {
    setTestingAudio(true);
    setTestResultMsg(null);
    setTestErrorMsg(null);
    setTestSteps({
      authVerified: false,
      voiceAvailable: false,
      audioGenerated: false,
      audioPlayed: false,
    });

    try {
      const res = await fetch('/api/elevenlabs/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hallo! Willkommen bei Deutsch Meister.',
          voiceId: settings.elevenLabsVoiceId || '',
          model: settings.elevenLabsModel || DEFAULT_ELEVENLABS_MODEL,
        }),
      });
      const json = await res.json().catch(() => null);

      if (json?.data) {
        setTestSteps({
          authVerified: Boolean(json.data.authVerified),
          voiceAvailable: Boolean(json.data.voiceAvailable),
          audioGenerated: Boolean(json.data.audioGenerated),
          audioPlayed: false,
        });
      }

      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `فشل اختبار ElevenLabs (HTTP ${res.status}).`);
      }
      if (!json.data?.audioBase64) {
        throw new Error('لم يعد الخادم ملف MP3 قابلاً للتشغيل.');
      }

      const durationSec = await verifyRealAudioPlayback(json.data.audioBase64);
      setElevenLabsConfigured(true);
      setTestSteps({
        authVerified: true,
        voiceAvailable: true,
        audioGenerated: true,
        audioPlayed: true,
      });

      const quotaText =
        typeof json.data?.quota?.remainingCharacters === 'number'
          ? ` • الرصيد المتبقي: ${json.data.quota.remainingCharacters.toLocaleString()} حرف`
          : '';

      setTestResultMsg(
        `✓ اكتمل التحقق بالكامل: المصادقة ناجحة، الصوت "${json.data.voiceName}" متاح، تم توليد ${json.data.bytes} بايت MP3 (${json.data.latencyMs}ms)، وتم التشغيل الفعلي (${durationSec.toFixed(1)}ث)${quotaText}.`
      );
      await fetchAvailableElevenLabsVoices();
    } catch (err: any) {
      setTestErrorMsg(err?.message || 'تعذر إتمام اختبار ElevenLabs.');
    } finally {
      setTestingAudio(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutFromSupabase();
      setSupabaseTestMsg(null);
      setSupabaseTestErr(null);
    } catch (err) {
      console.error('Supabase sign out error:', err);
    }
  };

  const handleTestSupabaseStorage = async () => {
    setTestingSupabase(true);
    setSupabaseTestMsg(null);
    setSupabaseTestErr(null);
    try {
      const res = await testSupabaseStorageConnection();
      setSupabaseTestMsg(
        `✓ تم التحقق من Auth ورفع/قراءة/تنزيل/حذف الملف داخل حاوية ${res.bucket} (${res.verifiedBytes} بايت) للمستخدم ${res.email || res.userId}.`
      );
    } catch (err: any) {
      setSupabaseTestErr(err?.message || 'فشل اختبار Supabase Auth/Storage.');
    } finally {
      setTestingSupabase(false);
    }
  };

  const handleCopySqlSnippet = () => {
    const snippet = `-- Run /supabase/schema.sql inside Supabase Dashboard -> SQL Editor
-- Creates saved_texts, saved_vocabulary, reading_history, user_settings + private bucket 'german-learning' with RLS policies.`;
    navigator.clipboard?.writeText(snippet).catch(() => {});
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  const filteredVoices = availableVoices.filter((v) => v.gender === genderTab);
  const displayedVoices = filteredVoices.length > 0 ? filteredVoices : availableVoices;

  return (
    <div className="space-y-8 animate-in fade-in max-w-4xl" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200/80 dark:border-slate-800">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold mb-1">
            <Settings className="w-3.5 h-3.5" />
            <span>تفضيلات الاستوديو</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
            إعدادات التطبيق والصوت
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            تخصيص صوت ElevenLabs، سرعة القراءة، التخزين المحلي في المتصفح (IndexedDB)، والمزامنة السحابية عبر Supabase.
          </p>
        </div>

        <button
          onClick={onResetSettings}
          className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>استعادة الافتراضي</span>
        </button>
      </div>

      <div className="space-y-6">
        {/* ElevenLabs Server Engine Status & Live Test */}
        <section className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span>محرك الصوت الحصري: ElevenLabs API</span>
                  {elevenLabsConfigured === true && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 text-[11px] font-bold">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>مضبوط على الخادم</span>
                    </span>
                  )}
                  {elevenLabsConfigured === false && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 text-[11px] font-bold">
                      <AlertCircle className="w-3 h-3" />
                      <span>ELEVENLABS_API_KEY غير مضبوط</span>
                    </span>
                  )}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  تتم جميع عمليات توليد الصوت عبر ElevenLabs فقط باستخدام المفتاح السري على الخادم، وتُخزَّن المقاطع في كاش المتصفح (IndexedDB).
                </p>
              </div>
            </div>

            <button
              onClick={handleTestElevenLabs}
              disabled={testingAudio}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{testingAudio ? 'جارٍ الاختبار...' : 'اختبار صوت ElevenLabs الآن'}</span>
            </button>
          </div>

          {testSteps && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-bold">
              {[
                { label: '1. مصادقة API', ok: testSteps.authVerified },
                { label: '2. توفر الصوت', ok: testSteps.voiceAvailable },
                { label: '3. توليد MP3 حقيقي', ok: testSteps.audioGenerated },
                { label: '4. التشغيل الفعلي', ok: testSteps.audioPlayed },
              ].map((step) => (
                <div
                  key={step.label}
                  className={`px-3 py-2 rounded-xl border flex items-center gap-1.5 ${
                    step.ok
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {step.ok ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>{step.label}</span>
                </div>
              ))}
            </div>
          )}

          {voicesError && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs font-semibold text-amber-800 dark:text-amber-200">
              ⚠ تعذر جلب الأصوات المباشرة من ElevenLabs: {voicesError}
            </div>
          )}

          {testResultMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-bold text-emerald-700 dark:text-emerald-300">
              {testResultMsg}
            </div>
          )}
          {testErrorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center justify-between gap-2">
              <span>✕ {testErrorMsg}</span>
              <button
                onClick={handleTestElevenLabs}
                className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-bold shrink-0"
              >
                إعادة المحاولة
              </button>
            </div>
          )}
        </section>

        {/* ElevenLabs Voice & Speed Settings Card */}
        <section className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <Volume2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
                  <span>أصوات اللغة الألمانية (ElevenLabs فقط)</span>
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                      voicesSource === 'elevenlabs-live'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {voicesSource === 'elevenlabs-live'
                      ? `مجلوبة مباشرة من حسابك (${availableVoices.length})`
                      : 'قائمة افتراضية'}
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  يُستخدم نفس الصوت المختار لقراءة الجمل الكاملة ولنطق الكلمات الفردية عند النقر عليها
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fetchAvailableElevenLabsVoices()}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                title="تحديث قائمة الأصوات من ElevenLabs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                <button
                  onClick={() => setGenderTab('female')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                    genderTab === 'female'
                      ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-xs'
                      : 'text-slate-500'
                  }`}
                >
                  أصوات نسائية
                </button>
                <button
                  onClick={() => setGenderTab('male')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                    genderTab === 'male'
                      ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-xs'
                      : 'text-slate-500'
                  }`}
                >
                  أصوات ذكورية
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {displayedVoices.map((v) => {
              const selected = settings.elevenLabsVoiceId === v.voiceId;
              return (
                <div
                  key={v.voiceId}
                  onClick={() =>
                    onUpdateSettings({
                      voice: v.name,
                      voiceGender: v.gender,
                      elevenLabsVoiceId: v.voiceId,
                      elevenLabsModel: DEFAULT_ELEVENLABS_MODEL,
                    })
                  }
                  className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-start gap-3 ${
                    selected
                      ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/30'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 shrink-0 ${
                      selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300'
                    }`}
                  >
                    {selected && <Check className="w-3 h-3 stroke-[3]" />}
                  </div>
                  <div className="min-w-0">
                    <span className="font-bold text-sm text-slate-900 dark:text-white block">
                      {v.labelArabic}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 block mt-0.5 leading-relaxed">
                      {v.description}
                    </span>
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                        ElevenLabs Multilingual v2
                      </span>
                      {v.isDefaultFemale && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                          الصوت الافتراضي الموصى به
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Speed slider & options */}
          <div className="space-y-3 pt-3">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Gauge className="w-4 h-4 text-blue-500" />
                سرعة التشغيل الافتراضية (تُطبق مباشرة بدون إعادة توليد الصوت):
              </span>
              <span className="font-bold text-blue-600 dark:text-blue-400 text-sm">
                {settings.speed}x
              </span>
            </label>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {speeds.map((spd) => (
                <button
                  key={spd}
                  onClick={() => onUpdateSettings({ speed: spd })}
                  className={`py-2 px-1 text-center rounded-xl border text-xs font-bold transition-all ${
                    settings.speed === spd
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-blue-400'
                  }`}
                >
                  {spd}x
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 bg-blue-50/60 dark:bg-slate-800/40 rounded-2xl border border-blue-100 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
            <span className="font-bold text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
              <Info className="w-4 h-4" />
              كيف يعمل الصوت والتخزين؟
            </span>
            <p className="leading-relaxed">
              1. <strong>ElevenLabs حصرياً:</strong> يتم توليد كل جملة أو كلمة من واجهة ElevenLabs الرسمية عبر الخادم، ولا يُستخدم أي صوت متصفح بديل.
            </p>
            <p className="leading-relaxed">
              2. <strong>التخزين المحلي والمزامنة السحابية:</strong> تُحفظ النصوص والمفردات وسجل القراءة وكاش الصوت محلياً في IndexedDB للعمل دون إنترنت، وعند تسجيل الدخول بحساب Supabase تتم مزامنتها وحفظ مستنداتك في حاوية <code>german-learning</code> الخاصة.
            </p>
          </div>
        </section>

        {/* Reading Engine Behaviors */}
        <section className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-6">
          <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">سلوك محرك القراءة</h2>
              <p className="text-xs text-slate-400">
                التحكم في التمرير الآلي، نمط القراءة، ومؤقت الجلسات
              </p>
            </div>
          </div>

          <div className="space-y-5">
            {/* Reading Mode */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700">
              <div>
                <span className="font-bold text-sm text-slate-900 dark:text-white block">
                  نمط القراءة الافتراضي:
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {settings.readingMode === 'continuous'
                    ? 'قراءة مستمرة جملة تلو الأخرى دون توقف تلقائي'
                    : 'التوقف بعد كل جملة لإتاحة التكرار وقراءة الترجمة'}
                </span>
              </div>
              <div className="flex items-center bg-white dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => onUpdateSettings({ readingMode: 'continuous' })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    settings.readingMode === 'continuous'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  قراءة مستمرة (افتراضي)
                </button>
                <button
                  onClick={() => onUpdateSettings({ readingMode: 'sentence-step' })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    settings.readingMode === 'sentence-step'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  خطوة بخطوة (تعليمي)
                </button>
              </div>
            </div>

            {/* Auto resume after word pronunciation */}
            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700">
              <div>
                <span className="font-bold text-sm text-slate-900 dark:text-white block">
                  استئناف القراءة تلقائياً بعد نطق الكلمة الفردية:
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  عند النقر على كلمة، يتم نطقها فقط. هل ترغب باستئناف قراءة النص بعدها تلقائياً؟ (الافتراضي: إيقاف)
                </span>
              </div>
              <button
                onClick={() =>
                  onUpdateSettings({ autoResumeAfterWord: !settings.autoResumeAfterWord })
                }
                className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${
                  settings.autoResumeAfterWord ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 bottom-0.5 w-5 rounded-full bg-white transition-transform ${
                    settings.autoResumeAfterWord ? 'left-0.5' : 'right-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Auto scroll */}
            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700">
              <div>
                <span className="font-bold text-sm text-slate-900 dark:text-white block">
                  التمرير التلقائي للجملة النشطة:
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  تمرير الشاشة تلقائياً بحيث تكون الجملة التي يتم قراءتها دائماً في منتصف الشاشة.
                </span>
              </div>
              <button
                onClick={() => onUpdateSettings({ autoScroll: !settings.autoScroll })}
                className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${
                  settings.autoScroll ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 bottom-0.5 w-5 rounded-full bg-white transition-transform ${
                    settings.autoScroll ? 'left-0.5' : 'right-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Session Timer preset */}
            <div className="space-y-2 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-indigo-500" />
                مؤقت جلسات الاستماع والتركيز:
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {timerOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => onUpdateSettings({ timerMinutes: opt.value })}
                    className={`p-2.5 rounded-xl border text-xs font-bold transition-all text-center ${
                      settings.timerMinutes === opt.value
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-indigo-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Browser Storage Overview (IndexedDB for Texts/Vocab/History/Audio + localStorage for Settings) */}
        <section className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  التخزين المحلي في المتصفح (IndexedDB & localStorage)
                </h2>
                <p className="text-xs text-slate-400">
                  النصوص والمفردات وسجل القراءة والكاش الصوتي في IndexedDB • التفضيلات في localStorage
                </p>
              </div>
            </div>

            {dataSummary.historyCount > 0 && (
              <button
                onClick={handleClearHistory}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                تصفير سجل القراءة
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700">
              <span className="text-slate-400 block">النصوص المحفوظة</span>
              <strong className="text-lg font-black text-slate-900 dark:text-white">
                {dataSummary.textsCount}
              </strong>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700">
              <span className="text-slate-400 block">المفردات المحفوظة</span>
              <strong className="text-lg font-black text-slate-900 dark:text-white">
                {dataSummary.vocabularyCount}
              </strong>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700">
              <span className="text-slate-400 block">سجلات القراءة</span>
              <strong className="text-lg font-black text-slate-900 dark:text-white">
                {dataSummary.historyCount}
              </strong>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700">
              <span className="text-slate-400 block">كاش الصوت</span>
              <strong className="text-sm font-black text-blue-600 dark:text-blue-400">
                {localStats.count} ({formatBytes(localStats.totalBytes)})
              </strong>
            </div>
          </div>
        </section>

        {/* Supabase Cloud Sync & Private Storage (`german-learning`) */}
        <section className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Cloud className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
                  <span>المزامنة السحابية والتخزين الخاص (Supabase)</span>
                  {supabaseConfigured ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 text-[11px] font-bold">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>متصل بالإعدادات</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 text-[11px] font-bold">
                      <AlertCircle className="w-3 h-3" />
                      <span>بانتظار SUPABASE_URL و SUPABASE_PUBLISHABLE_KEY</span>
                    </span>
                  )}
                </h2>
                <p className="text-xs text-slate-400">
                  مزامنة النصوص والمستندات (<code>german-learning</code>) والمفردات وسجل القراءة والإعدادات عبر أجهزتك مع حماية RLS
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {supabaseUserEmail ? (
                <>
                  {onSyncWithSupabase && (
                    <button
                      onClick={async () => {
                        await onSyncWithSupabase();
                        await loadLocalCache();
                      }}
                      disabled={supabaseSyncState === 'syncing'}
                      className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${supabaseSyncState === 'syncing' ? 'animate-spin' : ''}`} />
                      <span>{supabaseSyncState === 'syncing' ? 'جارٍ المزامنة...' : 'مزامنة الآن'}</span>
                    </button>
                  )}
                  <button
                    onClick={handleTestSupabaseStorage}
                    disabled={testingSupabase}
                    className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>{testingSupabase ? 'جارٍ الاختبار...' : 'اختبار التخزين'}</span>
                  </button>
                  <button
                    onClick={handleSignOut}
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>خروج</span>
                  </button>
                </>
              ) : (
                onOpenAuthModal && (
                  <button
                    onClick={onOpenAuthModal}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>تسجيل الدخول / إنشاء حساب</span>
                  </button>
                )
              )}
            </div>
          </div>

          {supabaseUserEmail && (
            <div className="p-3.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/60 text-xs flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-slate-500 dark:text-slate-400">الحساب النشط: </span>
                <strong className="text-slate-900 dark:text-white font-mono" dir="ltr">
                  {supabaseUserEmail}
                </strong>
              </div>
              <span className="text-emerald-700 dark:text-emerald-300 font-bold">
                {supabaseSyncState === 'syncing'
                  ? 'جارٍ المزامنة مع السحابة...'
                  : supabaseLastSyncedAt
                  ? `آخر مزامنة: ${new Date(supabaseLastSyncedAt).toLocaleTimeString('ar-EG')}`
                  : 'جاهز للمزامنة'}
              </span>
            </div>
          )}

          {supabaseTestMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-bold text-emerald-700 dark:text-emerald-300">
              {supabaseTestMsg}
            </div>
          )}

          {supabaseTestErr && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs font-bold text-rose-700 dark:text-rose-300">
              ✕ {supabaseTestErr}
            </div>
          )}

          {supabaseSyncError && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
              ✕ {supabaseSyncError}
            </div>
          )}

          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowSqlGuide(!showSqlGuide)}
              className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1.5 hover:underline"
            >
              {showSqlGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              <span>تعليمات إعداد لوحة تحكم Supabase وسياسات SQL / RLS</span>
            </button>

            {showSqlGuide && (
              <div className="mt-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs space-y-2 text-slate-600 dark:text-slate-300">
                <div className="flex items-center justify-between">
                  <strong className="text-slate-800 dark:text-white">خطوات التفعيل السريع:</strong>
                  <button
                    type="button"
                    onClick={handleCopySqlSnippet}
                    className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-bold flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{copiedSql ? 'تم النسخ' : 'نسخ الملاحظة'}</span>
                  </button>
                </div>
                <ol className="list-decimal list-inside space-y-1 leading-relaxed">
                  <li>
                    أضف <code>SUPABASE_URL</code> و <code>SUPABASE_PUBLISHABLE_KEY</code> و <code>ELEVENLABS_API_KEY</code> في متغيرات بيئة Vercel (Vercel Environment Variables) أو أسرار المشروع (Secrets).
                  </li>
                  <li>
                    افتح <strong>SQL Editor</strong> في لوحة تحكم Supabase وشغّل محتوى ملف <code>supabase/schema.sql</code> لإنشاء الجداول الأربعة، سياسات RLS، والحاوية الخاصة <code>german-learning</code>.
                  </li>
                  <li>
                    من <strong>Authentication → Providers</strong> فعّل <strong>Email</strong> (ويمكنك تعطيل Confirm Email للاختبار الفوري أو تفعيله للإنتاج).
                  </li>
                </ol>
              </div>
            )}
          </div>
        </section>

        {/* Local Browser Audio Cache (IndexedDB) Management */}
        <section className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <HardDrive className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  الكاش الصوتي المحلي في المتصفح (IndexedDB)
                </h2>
                <p className="text-xs text-slate-400">
                  {localStats.count} مقطع صوتي من ElevenLabs محفوظ محلياً • الحجم: {formatBytes(localStats.totalBytes)}
                </p>
              </div>
            </div>

            {localStats.count > 0 && (
              <div>
                {confirmClearLocal ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleClearLocalCache}
                      className="px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-bold"
                    >
                      تأكيد المسح بالكامل
                    </button>
                    <button
                      onClick={() => setConfirmClearLocal(false)}
                      className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold"
                    >
                      إلغاء
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmClearLocal(true)}
                    className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>مسح الكاش المحلي</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {localEntries.length === 0 ? (
            <p className="text-xs text-slate-400">
              لا توجد مقاطع صوتية مخزنة في متصفحك بعد. عند استماعك لأي كلمة أو جملة عبر ElevenLabs يتم حفظها هنا للتشغيل الفوري.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-56 overflow-y-auto rounded-2xl border border-slate-100 dark:border-slate-800">
              {localEntries.slice(0, 30).map((entry) => (
                <div
                  key={entry.audioHash}
                  className="p-2.5 flex items-center justify-between gap-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-german font-semibold text-slate-800 dark:text-slate-100 truncate" dir="ltr">
                      {entry.text}
                    </p>
                    <span className="text-[11px] text-slate-400">
                      {entry.sourceType} • {formatBytes(entry.size)}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDeleteLocalEntry(entry.audioHash)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600"
                    title="حذف من هذا المتصفح"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
