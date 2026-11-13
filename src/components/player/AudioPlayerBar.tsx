import React, { useState, useEffect } from 'react';
import {
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  RotateCcw,
  Gauge,
  Sparkles,
  Repeat,
  Repeat1,
  Maximize2,
  HardDrive,
  AlertCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import { AudioSourceStatus, ElevenLabsVoiceOption, ReadingSettings, VoiceGender } from '../../types';
import { audioEngine, PlaybackState } from '../../services/audioEngine';
import {
  DEFAULT_ELEVENLABS_MODEL,
  getAvailableElevenLabsVoices,
  onElevenLabsVoicesChange,
} from '../../services/elevenLabsVoices';

interface AudioPlayerBarProps {
  totalSentences: number;
  currentSentenceIndex: number;
  settings: ReadingSettings;
  onUpdateSettings: (newSettings: Partial<ReadingSettings>) => void;
  onToggleConcentrationMode?: () => void;
}

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({
  totalSentences,
  currentSentenceIndex,
  settings,
  onUpdateSettings,
  onToggleConcentrationMode,
}) => {
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
  const [sourceStatus, setSourceStatus] = useState<AudioSourceStatus>(
    audioEngine.getSourceStatus()
  );
  const [liveSentenceIndex, setLiveSentenceIndex] = useState<number>(currentSentenceIndex);
  const [errorText, setErrorText] = useState<string | null>(audioEngine.getLastError());
  const [showSpeedMenu, setShowSpeedMenu] = useState<boolean>(false);
  const [showVoiceMenu, setShowVoiceMenu] = useState<boolean>(false);
  const [genderFilter, setGenderFilter] = useState<VoiceGender>(
    settings.voiceGender || 'female'
  );
  const [availableVoices, setAvailableVoices] = useState<ElevenLabsVoiceOption[]>(
    () => getAvailableElevenLabsVoices().voices
  );

  useEffect(() => {
    setLiveSentenceIndex(currentSentenceIndex);
  }, [currentSentenceIndex]);

  useEffect(() => {
    const unsubState = audioEngine.onStateChange((st) => {
      setPlaybackState(st);
      if (st === 'playing' || st === 'loading' || st === 'stopped') {
        setErrorText(null);
      }
    });
    const unsubSource = audioEngine.onSourceChange((src) => {
      setSourceStatus(src);
    });
    const unsubSentence = audioEngine.onSentenceChange((idx) => {
      setLiveSentenceIndex(idx);
    });
    const unsubError = audioEngine.onError((msg) => {
      setErrorText(msg);
    });

    const unsubVoices = onElevenLabsVoicesChange((snapshot) => {
      setAvailableVoices(snapshot.voices);
    });

    setPlaybackState(audioEngine.getState());
    setSourceStatus(audioEngine.getSourceStatus());

    return () => {
      unsubState();
      unsubSource();
      unsubSentence();
      unsubError();
      unsubVoices();
    };
  }, []);

  const speeds = [0.5, 0.75, 0.85, 1.0, 1.15, 1.25, 1.5, 2.0];

  const handlePlayPause = () => {
    if (playbackState === 'playing') {
      audioEngine.pause();
    } else if (playbackState === 'paused') {
      audioEngine.resume();
    } else if (playbackState === 'error') {
      audioEngine.retryLast();
    } else {
      audioEngine.play(liveSentenceIndex >= 0 ? liveSentenceIndex : 0);
    }
  };

  const handleStop = () => {
    audioEngine.stop();
    setErrorText(null);
  };

  const handlePrev = () => {
    audioEngine.prevSentence();
  };

  const handleNext = () => {
    audioEngine.nextSentence();
  };

  const handleRepeatSentence = () => {
    audioEngine.repeatCurrentSentence();
  };

  const handleRetry = () => {
    setErrorText(null);
    audioEngine.retryLast();
  };

  const getSourceBadgeStyle = (status: AudioSourceStatus) => {
    if (status === 'Local Cached Audio') {
      return {
        cls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800',
        icon: <HardDrive className="w-3 h-3" />,
        label: 'كاش المتصفح (ElevenLabs)',
      };
    }
    return {
      cls: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800',
      icon: <Sparkles className="w-3 h-3" />,
      label: 'صوت ElevenLabs',
    };
  };

  const badge = getSourceBadgeStyle(sourceStatus);
  const currentDisplayIndex =
    totalSentences > 0 ? Math.min(liveSentenceIndex + 1, totalSentences) : 0;
  const progressPercent = totalSentences > 0 ? (currentDisplayIndex / totalSentences) * 100 : 0;

  const filteredVoices = availableVoices.filter((v) => v.gender === genderFilter);
  const displayedVoices = filteredVoices.length > 0 ? filteredVoices : availableVoices;
  const activeVoiceLabel =
    availableVoices.find((v) => v.voiceId === settings.elevenLabsVoiceId)?.name.split(' ')[0] ||
    settings.voice.split(' ')[0] ||
    'Sarah';

  const toggleRepeatMode = () => {
    const modes: ReadingSettings['repeatMode'][] = ['none', 'sentence', 'all'];
    const currentIdx = modes.indexOf(settings.repeatMode);
    const nextMode = modes[(currentIdx + 1) % modes.length];
    onUpdateSettings({ repeatMode: nextMode });
  };

  return (
    <>
      {/* ElevenLabs Error Banner with Retry Button */}
      {errorText && (
        <div
          className="fixed bottom-20 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-lg z-50 bg-rose-950 text-white text-xs px-4 py-3 rounded-2xl shadow-2xl border border-rose-700 flex items-center justify-between gap-3"
          dir="rtl"
          role="alert"
        >
          <div className="flex items-start gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
            <div className="space-y-0.5 min-w-0">
              <span className="font-bold block text-rose-200">تعذر تشغيل صوت ElevenLabs</span>
              <span className="block text-rose-100 leading-relaxed">{errorText}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleRetry}
              className="px-3 py-1.5 rounded-xl bg-white text-rose-900 hover:bg-rose-100 font-bold text-xs flex items-center gap-1 shadow-xs transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>إعادة المحاولة</span>
            </button>
            <button
              onClick={() => setErrorText(null)}
              className="p-1 text-rose-300 hover:text-white"
              aria-label="إغلاق رسالة الخطأ"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <div
        className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 shadow-2xl transition-all"
        dir="rtl"
      >
        {/* Visual Progress Line */}
        <div className="w-full bg-slate-100 dark:bg-slate-800 h-1 relative overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ease-out ${
              playbackState === 'error' ? 'bg-rose-600' : 'bg-blue-600'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 sm:py-3 flex flex-wrap items-center justify-between gap-3">
          {/* Left Side: Sentence Tracker & Audio Source Status */}
          <div className="flex items-center gap-3 min-w-[200px]">
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    playbackState === 'error' ? 'bg-rose-500' : 'bg-blue-500 animate-pulse'
                  }`}
                />
                <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  الجملة {currentDisplayIndex} من {totalSentences}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {playbackState === 'playing' && 'جارٍ القراءة...'}
                  {playbackState === 'loading' && 'جارٍ توليد الصوت عبر ElevenLabs...'}
                  {playbackState === 'paused' && 'متوقف مؤقتاً'}
                  {playbackState === 'stopped' && 'جاهز للاستماع'}
                  {playbackState === 'idle' && 'جاهز'}
                  {playbackState === 'error' && (
                    <span className="text-rose-600 dark:text-rose-400 font-bold">توقف بسبب خطأ في ElevenLabs</span>
                  )}
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-bold ${badge.cls}`}
                  title="مصدر الصوت النشط"
                >
                  {badge.icon}
                  <span>{badge.label}</span>
                </span>
              </div>
            </div>

            {/* Repeat mode badge */}
            <button
              onClick={toggleRepeatMode}
              className={`p-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${
                settings.repeatMode !== 'none'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300'
                  : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
              title={
                settings.repeatMode === 'sentence'
                  ? 'تكرار الجملة الحالية مفعّل'
                  : settings.repeatMode === 'all'
                  ? 'تكرار النص بالكامل مفعّل'
                  : 'بدون تكرار'
              }
            >
              {settings.repeatMode === 'sentence' ? (
                <Repeat1 className="w-4 h-4" />
              ) : (
                <Repeat className="w-4 h-4" />
              )}
              <span className="hidden sm:inline text-[11px]">
                {settings.repeatMode === 'sentence'
                  ? 'تكرار الجملة'
                  : settings.repeatMode === 'all'
                  ? 'تكرار النص'
                  : 'تكرار'}
              </span>
            </button>
          </div>

          {/* Center: Main Playback Controls */}
          <div className="flex items-center gap-1 sm:gap-2 mx-auto">
            <button
              onClick={handlePrev}
              disabled={liveSentenceIndex <= 0}
              className="p-2 sm:p-2.5 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
              title="الجملة السابقة"
            >
              <SkipForward className="w-5 h-5" />
            </button>

            <button
              onClick={handleRepeatSentence}
              disabled={totalSentences === 0}
              className="p-2 sm:p-2.5 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
              title="إعادة نطق الجملة الحالية"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              onClick={handlePlayPause}
              disabled={totalSentences === 0}
              className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg transition-transform active:scale-95 ${
                playbackState === 'playing'
                  ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/25 ring-4 ring-amber-100 dark:ring-amber-950/40'
                  : playbackState === 'error'
                  ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/30 ring-4 ring-rose-100 dark:ring-rose-950/40'
                  : 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/30 ring-4 ring-blue-100 dark:ring-blue-950/40'
              }`}
              title={
                playbackState === 'playing'
                  ? 'إيقاف مؤقت'
                  : playbackState === 'error'
                  ? 'إعادة محاولة التشغيل'
                  : 'تشغيل القراءة جملة تلو الأخرى'
              }
            >
              {playbackState === 'playing' ? (
                <Pause className="w-6 h-6 fill-current" />
              ) : playbackState === 'error' ? (
                <RefreshCw className="w-5 h-5" />
              ) : (
                <Play className="w-6 h-6 fill-current translate-x-[-1px]" />
              )}
            </button>

            <button
              onClick={handleStop}
              disabled={playbackState === 'stopped' || playbackState === 'idle'}
              className="p-2 sm:p-2.5 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
              title="إيقاف كامل"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>

            <button
              onClick={handleNext}
              disabled={liveSentenceIndex >= totalSentences - 1}
              className="p-2 sm:p-2.5 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
              title="الجملة التالية"
            >
              <SkipBack className="w-5 h-5" />
            </button>
          </div>

          {/* Right Side: Speed, ElevenLabs Voice & Concentration Mode */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Speed Selector Dropdown */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowSpeedMenu(!showSpeedMenu);
                  setShowVoiceMenu(false);
                }}
                className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-750 flex items-center gap-1.5 transition-colors"
                title="سرعة القراءة (لا تؤثر على الكاش)"
              >
                <Gauge className="w-3.5 h-3.5 text-blue-500" />
                <span>{settings.speed}x</span>
              </button>

              {showSpeedMenu && (
                <div className="absolute bottom-full mb-2 right-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl p-1.5 min-w-[140px] z-50 animate-in fade-in">
                  <span className="text-[11px] font-bold text-slate-400 px-2 py-1 block">
                    سرعة التشغيل:
                  </span>
                  {speeds.map((spd) => (
                    <button
                      key={spd}
                      onClick={() => {
                        onUpdateSettings({ speed: spd });
                        setShowSpeedMenu(false);
                      }}
                      className={`w-full text-right px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-between transition-colors ${
                        settings.speed === spd
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      <span>{spd}x</span>
                      <span className="text-[10px] text-slate-400">
                        {spd === 1.0 ? 'طبيعي' : spd < 1.0 ? 'تعليمي بطيء' : 'سريع'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ElevenLabs Voice Selector Dropdown (ONLY ElevenLabs Voices) */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowVoiceMenu(!showVoiceMenu);
                  setShowSpeedMenu(false);
                }}
                className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-750 flex items-center gap-1.5 transition-colors"
                title="اختيار صوت ElevenLabs الألماني"
              >
                <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                <span className="hidden sm:inline">{activeVoiceLabel}</span>
                <span className="text-[10px] text-slate-400 font-normal sm:hidden">صوت</span>
              </button>

              {showVoiceMenu && (
                <div className="absolute bottom-full mb-2 left-0 sm:right-auto sm:left-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl p-2.5 min-w-[290px] z-50 animate-in fade-in space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[11px] font-bold text-slate-400">
                      أصوات ElevenLabs الألمانية:
                    </span>
                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-900 p-0.5 rounded-lg">
                      <button
                        onClick={() => setGenderFilter('female')}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          genderFilter === 'female'
                            ? 'bg-white dark:bg-slate-700 text-blue-600'
                            : 'text-slate-500'
                        }`}
                      >
                        أنثى
                      </button>
                      <button
                        onClick={() => setGenderFilter('male')}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          genderFilter === 'male'
                            ? 'bg-white dark:bg-slate-700 text-blue-600'
                            : 'text-slate-500'
                        }`}
                      >
                        ذكر
                      </button>
                    </div>
                  </div>

                  {displayedVoices.map((v) => {
                    const isSelected = settings.elevenLabsVoiceId === v.voiceId;
                    return (
                      <button
                        key={v.voiceId}
                        onClick={() => {
                          onUpdateSettings({
                            voice: v.name,
                            voiceGender: v.gender,
                            elevenLabsVoiceId: v.voiceId,
                            elevenLabsModel: DEFAULT_ELEVENLABS_MODEL,
                          });
                          setShowVoiceMenu(false);
                        }}
                        className={`w-full text-right p-2 rounded-lg text-xs font-semibold block transition-colors ${
                          isSelected
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold">{v.labelArabic}</span>
                          {v.isDefaultFemale && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                              افتراضي
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 font-normal block">
                          {v.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Concentration Mode button */}
            {onToggleConcentrationMode && (
              <button
                onClick={onToggleConcentrationMode}
                className={`p-2 rounded-xl border text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  settings.concentrationMode
                    ? 'bg-indigo-600 text-white border-indigo-700'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                }`}
                title="وضع التركيز والاستماع الممتد (Konzentrationsmodus)"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span className="hidden md:inline text-xs">وضع التركيز</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
