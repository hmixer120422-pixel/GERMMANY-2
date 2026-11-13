import React from 'react';
import { Headphones, Moon, Sun, Layers, Menu, X, FileText, Cloud, LogIn, RefreshCw } from 'lucide-react';
import { CEFRLevel, SupabaseSyncState } from '../../types';

interface NavbarProps {
  currentView: string;
  onNavigate: (view: string) => void;
  selectedLevel: CEFRLevel;
  onSelectLevel: (lvl: CEFRLevel) => void;
  isDark: boolean;
  onToggleTheme: () => void;
  onToggleMobileMenu: () => void;
  isMobileMenuOpen: boolean;
  supabaseUserEmail?: string | null;
  supabaseSyncState?: SupabaseSyncState;
  onOpenAuthModal?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onNavigate,
  selectedLevel,
  onSelectLevel,
  isDark,
  onToggleTheme,
  onToggleMobileMenu,
  isMobileMenuOpen,
  supabaseUserEmail,
  supabaseSyncState = 'idle',
  onOpenAuthModal,
}) => {
  const levels: CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

  return (
    <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-colors" dir="rtl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Logo and Brand */}
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleMobileMenu}
            className="md:hidden p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <button
            onClick={() => onNavigate('home')}
            className="flex items-center gap-3 group text-right"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-700 via-blue-600 to-indigo-500 text-white flex items-center justify-center shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
              <Headphones className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-base sm:text-lg text-slate-900 dark:text-white tracking-tight">
                  Deutsch Meister
                </span>
                <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-700 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  Lernstudio
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:block">
                استوديو القراءة والاستماع للغة الألمانية A1–C2
              </p>
            </div>
          </button>
        </div>

        {/* Level Switcher Pill & Actions */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Quick CEFR Level Switcher */}
          <div className="hidden lg:flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700">
            <span className="text-[11px] font-bold text-slate-400 px-2 flex items-center gap-1">
              <Layers className="w-3 h-3 text-blue-500" />
              المستوى:
            </span>
            <div className="flex items-center gap-0.5">
              {levels.map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => onSelectLevel(lvl)}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${
                    selectedLevel === lvl
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-700'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Import / Manual Input Action */}
          <button
            onClick={() => onNavigate('import')}
            className="hidden sm:flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-bold shadow-sm shadow-blue-500/20 transition-all active:scale-95"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>كتابة / استيراد نص</span>
          </button>

          {/* Supabase Auth / Cloud Sync Button */}
          {onOpenAuthModal && (
            <button
              onClick={() => (supabaseUserEmail ? onNavigate('settings') : onOpenAuthModal())}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-colors ${
                supabaseUserEmail
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-200/70'
              }`}
              title={
                supabaseUserEmail
                  ? `متصل بحساب Supabase: ${supabaseUserEmail}`
                  : 'تسجيل الدخول للمزامنة السحابية عبر Supabase'
              }
            >
              {supabaseUserEmail ? (
                <>
                  {supabaseSyncState === 'syncing' ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Cloud className="w-3.5 h-3.5" />
                  )}
                  <span className="hidden md:inline max-w-[120px] truncate" dir="ltr">
                    {supabaseUserEmail.split('@')[0]}
                  </span>
                </>
              ) : (
                <>
                  <LogIn className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">مزامنة سحابية</span>
                </>
              )}
            </button>
          )}

          {/* Dark / Light Mode Toggle */}
          <button
            onClick={onToggleTheme}
            className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title={isDark ? 'الوضع النهاري' : 'الوضع الليلي'}
          >
            {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
          </button>
        </div>
      </div>
    </header>
  );
};
