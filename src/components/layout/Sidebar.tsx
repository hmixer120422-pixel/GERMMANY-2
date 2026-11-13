import React from 'react';
import {
  Home,
  FileText,
  Headphones,
  BookOpen,
  Bookmark,
  History,
  Settings,
  GraduationCap,
  Volume2,
} from 'lucide-react';
import { CEFRLevel, ReadingSettings, ListeningStats } from '../../types';

interface SidebarProps {
  currentView: string;
  onNavigate: (view: string) => void;
  selectedLevel: CEFRLevel;
  settings: ReadingSettings;
  stats: ListeningStats;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  selectedLevel,
  settings,
  stats,
  isMobileOpen,
  onCloseMobile,
}) => {
  const navItems = [
    {
      id: 'home',
      label: 'الرئيسية',
      sublabel: 'لوحة التحكم والأنشطة',
      icon: Home,
    },
    {
      id: 'import',
      label: 'كتابة / استيراد نص',
      sublabel: 'لصق نص أو TXT / PDF / DOCX',
      icon: FileText,
    },
    {
      id: 'reader',
      label: 'القراءة والاستماع',
      sublabel: 'قراءة جملة بجملة بصوت نسائي',
      icon: Headphones,
    },
    {
      id: 'dictionary',
      label: 'قاموس الكلمات',
      sublabel: 'بحث وتحليل نحوي فوري',
      icon: BookOpen,
    },
    {
      id: 'vocabulary',
      label: 'كلماتي المحفوظة',
      sublabel: 'المفردات والبطاقات التعليمية',
      icon: Bookmark,
    },
    {
      id: 'history',
      label: 'سجل القراءة ومكتبتي',
      sublabel: 'النصوص السابقة والمستندات',
      icon: History,
    },
    {
      id: 'settings',
      label: 'الإعدادات',
      sublabel: 'تخصيص الصوت والمستويات',
      icon: Settings,
    },
  ];

  const voiceGenderLabel =
    settings.voiceGender === 'male' ? 'ذكوري' : 'أنثوي';

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-xs md:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Sidebar container */}
      <aside
        className={`fixed md:sticky top-16 right-0 z-40 h-[calc(100vh-4rem)] w-72 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col justify-between p-4 transition-transform duration-200 ease-in-out md:translate-x-0 overflow-y-auto ${
          isMobileOpen ? 'translate-x-0 shadow-2xl' : 'translate-x-full md:translate-x-0'
        }`}
        dir="rtl"
      >
        <div className="space-y-6">
          {/* Active Level Card */}
          <div className="p-3.5 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-md shadow-blue-600/15">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center">
                  <GraduationCap className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[11px] text-blue-100 font-medium block leading-tight">مستواك الحالي:</span>
                  <span className="text-sm font-black">CEFR {selectedLevel}</span>
                </div>
              </div>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-white/20 text-white">
                {selectedLevel === 'A1' && 'مبتدئ'}
                {selectedLevel === 'A2' && 'أساسي'}
                {selectedLevel === 'B1' && 'متوسط'}
                {selectedLevel === 'B2' && 'فوق متوسط'}
                {selectedLevel === 'C1' && 'متقدم'}
                {selectedLevel === 'C2' && 'إتقان تام'}
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            <span className="text-[11px] font-extrabold uppercase text-slate-400 px-3 tracking-wider block mb-2">
              التنقل الرئيسي
            </span>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onNavigate(item.id);
                    onCloseMobile();
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-right transition-all group ${
                    isActive
                      ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-bold border border-blue-200/80 dark:border-blue-900/60 shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white font-medium'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-1.5 rounded-lg transition-colors ${
                        isActive
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 group-hover:text-blue-600 group-hover:bg-blue-50'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs">{item.label}</div>
                      <div className="text-[10px] text-slate-400 font-normal">{item.sublabel}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Status / Stats Info */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
          {/* Quick Audio Persona Info */}
          <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200/60 dark:border-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-300 flex items-center justify-center">
                <Volume2 className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block leading-none">الصوت الحالي:</span>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {settings.voice} ({voiceGenderLabel})
                </span>
              </div>
            </div>
            <span className="text-[10px] font-semibold text-slate-500">{settings.speed}x</span>
          </div>

          {/* Listening Stats Mini Card */}
          <div className="grid grid-cols-2 gap-2 text-center text-[11px]">
            <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-lg border border-slate-100 dark:border-slate-800">
              <span className="text-slate-400 block text-[10px]">الجمل المقروءة</span>
              <span className="font-extrabold text-slate-800 dark:text-white">{stats.sentencesRead}</span>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-lg border border-slate-100 dark:border-slate-800">
              <span className="text-slate-400 block text-[10px]">الكلمات المحفوظة</span>
              <span className="font-extrabold text-slate-800 dark:text-white">{stats.wordsLookedUp}</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
