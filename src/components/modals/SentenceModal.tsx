import React, { useState, useEffect } from 'react';
import { Volume2, X, Sparkles, BookOpen, Repeat, AlertCircle, RotateCcw } from 'lucide-react';
import { SentenceExplanation } from '../../types';
import { audioEngine } from '../../services/audioEngine';

interface SentenceModalProps {
  sentence: string;
  context?: string;
  isOpen: boolean;
  onClose: () => void;
  onWordClick?: (word: string) => void;
}

export const SentenceModal: React.FC<SentenceModalProps> = ({
  sentence,
  context,
  isOpen,
  onClose,
  onWordClick,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SentenceExplanation | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !sentence) return;

    let isCancelled = false;
    setLoading(true);
    setError(null);
    setAudioError(null);

    fetch('/api/dictionary/explain-sentence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentence, context }),
    })
      .then(async (res) => {
        const rawText = await res.text();
        try {
          return JSON.parse(rawText);
        } catch {
          return { success: false, error: 'استجابة غير صالحة من الخادم' };
        }
      })
      .then((resData) => {
        if (isCancelled) return;
        if (resData.success && resData.data) {
          setData(resData.data);
        } else {
          import('../../data/germanDictionary')
            .then(({ analyzeGermanSentenceLocally }) => {
              if (!isCancelled) {
                setData(analyzeGermanSentenceLocally(sentence));
              }
            })
            .catch(() => {
              setError(resData.error || 'تعذر تحليل الجملة');
            });
        }
      })
      .catch((err) => {
        if (isCancelled) return;
        import('../../data/germanDictionary')
          .then(({ analyzeGermanSentenceLocally }) => {
            if (!isCancelled) {
              setData(analyzeGermanSentenceLocally(sentence));
            }
          })
          .catch(() => {
            setError(err.message || 'خطأ في الاتصال');
          });
      })
      .finally(() => {
        if (!isCancelled) setLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, sentence, context]);

  if (!isOpen || !sentence) return null;

  const handlePronounce = async () => {
    setAudioError(null);
    setIsPlaying(true);
    const ok = await audioEngine.playWordOnly(sentence);
    setIsPlaying(false);
    if (!ok) {
      setAudioError(audioEngine.getLastError() || 'تعذر توليد صوت الجملة عبر ElevenLabs.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs transition-opacity animate-in fade-in">
      <div
        className="relative w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-right"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">ترجمة وتحليل الجملة</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">فهم التراكيب النحوية والمفردات المستعملة</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[75vh] overflow-y-auto space-y-5">
          {/* German Sentence Box */}
          <div className="bg-slate-900 text-white p-5 rounded-xl shadow-inner">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-blue-300">الجملة الألمانية:</span>
              <button
                onClick={handlePronounce}
                className={`p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center gap-1 text-xs ${
                  isPlaying ? 'ring-2 ring-blue-400' : ''
                }`}
                title="استمع إلى الجملة بالصوت النسائي"
              >
                <Volume2 className="w-4 h-4" />
                استماع
              </button>
            </div>
            <p className="font-german text-lg font-medium leading-relaxed" dir="ltr">
              {sentence}
            </p>
          </div>

          {/* Translation Box */}
          <div className="bg-blue-50/60 dark:bg-slate-800/60 p-4 rounded-xl border border-blue-100 dark:border-slate-700">
            <span className="text-xs font-bold text-blue-700 dark:text-blue-400 block mb-1">
              الترجمة الدقيقة للعربية:
            </span>
            <p className="text-base font-semibold text-slate-800 dark:text-slate-100 leading-relaxed">
              {loading ? (
                <span className="inline-block w-48 h-5 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
              ) : (
                data?.arabicTranslation || '...'
              )}
            </p>
          </div>

          {loading && (
            <div className="py-6 text-center text-slate-400 space-y-2">
              <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs">جارٍ فحص القواعد والمفردات في الجملة...</p>
            </div>
          )}

          {audioError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 rounded-xl text-xs border border-rose-200 dark:border-rose-900/60 flex items-center justify-between gap-2">
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
            <div className="p-3 bg-rose-50 text-rose-700 rounded-lg text-sm">{error}</div>
          )}

          {data && (
            <div className="space-y-4">
              {/* Grammar Notes */}
              {data.grammarNotes && (
                <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 mb-2">
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    الملاحظات النحوية (Grammatik):
                  </h4>
                  <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                    {data.grammarNotes}
                  </p>
                </div>
              )}

              {/* Key Words in Sentence */}
              {data.keyWords && data.keyWords.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-2">
                    أهم المفردات في هذه الجملة:
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {data.keyWords.map((kw, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between"
                      >
                        <div>
                          <span className="font-german font-bold text-sm text-slate-900 dark:text-white" dir="ltr">
                            {kw.article ? `${kw.article} ` : ''}
                            {kw.german}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400 block mt-0.5">
                            {kw.arabic}
                          </span>
                        </div>
                        {onWordClick && (
                          <button
                            onClick={() => {
                              onClose();
                              onWordClick(kw.german);
                            }}
                            className="px-2 py-1 text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg transition-colors"
                          >
                            قاموس
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <button
            onClick={handlePronounce}
            className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
          >
            <Repeat className="w-4 h-4" />
            إعادة الاستماع للجملة
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
