import React, { useState, useEffect } from 'react';
import { Navbar } from './components/layout/Navbar';
import { Sidebar } from './components/layout/Sidebar';
import { AudioPlayerBar } from './components/player/AudioPlayerBar';
import { HomeView } from './components/views/HomeView';
import { ReaderView } from './components/views/ReaderView';
import { DictionaryView } from './components/views/DictionaryView';
import { VocabularyView } from './components/views/VocabularyView';
import { HistoryView } from './components/views/HistoryView';
import { SettingsView } from './components/views/SettingsView';
import { SupabaseAuthModal } from './components/modals/SupabaseAuthModal';
import {
  GermanTextPassage,
  CEFRLevel,
  ReadingSettings,
  SavedWord,
  ListeningStats,
  SupabaseSyncState,
} from './types';
import {
  initBrowserStorage,
  getStoredTexts,
  getActiveTextId,
  setActiveTextId,
  getStoredSavedWords,
  getStoredSettings,
  saveStoredSettings,
  getStoredStats,
  DEFAULT_SETTINGS,
  addTextPassage,
  hydrateFromSupabase,
} from './services/storage';
import {
  getSupabaseConfigStatus,
  initSupabaseClient,
} from './services/supabaseClient';
import { onSupabaseSyncChange } from './services/supabaseSync';
import { audioEngine } from './services/audioEngine';
import { splitGermanSentences } from './utils/audioHash';

export default function App() {
  const [currentView, setCurrentView] = useState<string>('home');
  const [readerTab, setReaderTab] = useState<'reading' | 'import'>('reading');
  const [settings, setSettings] = useState<ReadingSettings>(getStoredSettings());
  const [selectedLevel, setSelectedLevel] = useState<CEFRLevel>(settings.defaultLevel || 'A2');
  const [passages, setPassages] = useState<GermanTextPassage[]>([]);
  const [activePassage, setActivePassage] = useState<GermanTextPassage | null>(null);
  const [savedWords, setSavedWords] = useState<SavedWord[]>([]);
  const [stats, setStats] = useState<ListeningStats>(getStoredStats());
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const [activeSentenceIndex, setActiveSentenceIndex] = useState<number>(0);

  // Supabase Auth & Sync state
  const [supabaseConfigured, setSupabaseConfigured] = useState<boolean>(false);
  const [supabaseUserEmail, setSupabaseUserEmail] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [syncState, setSyncState] = useState<SupabaseSyncState>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const applyHydratedLocalState = () => {
    const storedTexts = getStoredTexts();
    setPassages(storedTexts);

    const activeId = getActiveTextId();
    const active = storedTexts.find((t) => t.id === activeId) || storedTexts[0] || null;
    setActivePassage(active);

    setSavedWords(getStoredSavedWords());
    setStats(getStoredStats());

    const latestSettings = getStoredSettings();
    setSettings(latestSettings);
    setSelectedLevel(latestSettings.defaultLevel || 'A2');
    audioEngine.updateSettings(latestSettings);
  };

  const handleSyncWithSupabase = async () => {
    const ok = await hydrateFromSupabase();
    if (ok) {
      applyHydratedLocalState();
    }
  };

  // Initialize local browser storage + Supabase auth & cross-device sync
  useEffect(() => {
    let mounted = true;
    let authSub: { unsubscribe: () => void } | null = null;

    const initialSettings = getStoredSettings();
    setSettings(initialSettings);
    setSelectedLevel(initialSettings.defaultLevel || 'A2');
    audioEngine.updateSettings(initialSettings);

    if (initialSettings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    initBrowserStorage().then(async () => {
      if (!mounted) return;
      applyHydratedLocalState();

      // Initialize Supabase client from SUPABASE_URL & SUPABASE_PUBLISHABLE_KEY
      const client = await initSupabaseClient();
      if (!mounted) return;
      setSupabaseConfigured(getSupabaseConfigStatus().configured);

      if (client) {
        const { data } = await client.auth.getSession();
        if (mounted && data.session?.user) {
          setSupabaseUserEmail(data.session.user.email || 'user');
          const synced = await hydrateFromSupabase();
          if (mounted && synced) applyHydratedLocalState();
        }

        const { data: listener } = client.auth.onAuthStateChange(async (_event, session) => {
          if (!mounted) return;
          if (session?.user) {
            setSupabaseUserEmail(session.user.email || 'user');
            const synced = await hydrateFromSupabase();
            if (mounted && synced) applyHydratedLocalState();
          } else {
            setSupabaseUserEmail(null);
          }
        });
        authSub = listener.subscription;
      }
    });

    // Sync default ElevenLabs voice metadata if user hasn't saved custom preferences yet
    fetch('/api/tts/voices')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (mounted && json?.success && json?.data) {
          const current = getStoredSettings();
          if (!localStorage.getItem('deutsch_meister_settings_v1')) {
            const synced: ReadingSettings = {
              ...current,
              elevenLabsVoiceId: json.data.defaultFemaleVoiceId || current.elevenLabsVoiceId,
              elevenLabsModel: json.data.model || current.elevenLabsModel,
            };
            setSettings(synced);
            audioEngine.updateSettings(synced);
          }
        }
      })
      .catch(() => {});

    const unsubSentence = audioEngine.onSentenceChange((idx) => {
      setActiveSentenceIndex(idx);
      setStats(getStoredStats());
    });

    const unsubSync = onSupabaseSyncChange((st) => {
      if (!mounted) return;
      setSyncState(st.state);
      setLastSyncedAt(st.lastSyncedAt);
      setSyncError(st.error);
    });

    return () => {
      mounted = false;
      unsubSentence();
      unsubSync();
      authSub?.unsubscribe();
    };
  }, []);

  const handleNavigate = (view: string) => {
    if (view === 'import') {
      setReaderTab('import');
      setCurrentView('reader');
      return;
    }
    if (view === 'reader') {
      setReaderTab('reading');
      setCurrentView('reader');
      return;
    }
    setCurrentView(view);
  };

  const handleUpdateSettings = (newSettings: Partial<ReadingSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    saveStoredSettings(updated);
    audioEngine.updateSettings(updated);
  };

  const handleResetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
    saveStoredSettings(DEFAULT_SETTINGS);
    audioEngine.updateSettings(DEFAULT_SETTINGS);
  };

  const handleToggleTheme = () => {
    const nextTheme = settings.theme === 'dark' ? 'light' : 'dark';
    handleUpdateSettings({ theme: nextTheme });
  };

  const handleSelectLevel = (lvl: CEFRLevel) => {
    setSelectedLevel(lvl);
    handleUpdateSettings({ defaultLevel: lvl });
  };

  const handleSelectPassage = (passage: GermanTextPassage) => {
    setActivePassage(passage);
    setActiveTextId(passage.id);
    setPassages(getStoredTexts());
    setReaderTab('reading');
    setCurrentView('reader');
  };

  const handleOpenManualTextFromHome = (title: string, text: string) => {
    const sentences = splitGermanSentences(text);
    const newPassage: GermanTextPassage = {
      id: 'manual-' + Date.now(),
      title: title || 'نص ألماني مخصص',
      authorInfo: 'نص مُدخل يدوياً',
      level: selectedLevel,
      germanText: text,
      sentences: sentences.length > 0 ? sentences : [text],
      arabicSummary: '',
      keyVocabulary: [],
      wordCount: text.split(/\s+/).filter(Boolean).length,
      style: 'Custom Text',
      topic: title || 'نص يدوي',
      createdAt: new Date().toISOString(),
    };
    addTextPassage(newPassage);
    handleSelectPassage(newPassage);
  };

  const refreshWords = () => {
    setSavedWords(getStoredSavedWords());
    setStats(getStoredStats());
  };

  const refreshPassages = () => {
    const updated = getStoredTexts();
    setPassages(updated);
    if (activePassage && !updated.find((p) => p.id === activePassage.id)) {
      setActivePassage(updated[0] || null);
    }
  };

  const activeNavId = currentView === 'reader' && readerTab === 'import' ? 'import' : currentView;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-arabic transition-colors" dir="rtl">
      {/* Top Navbar */}
      <Navbar
        currentView={activeNavId}
        onNavigate={handleNavigate}
        selectedLevel={selectedLevel}
        onSelectLevel={handleSelectLevel}
        isDark={settings.theme === 'dark'}
        onToggleTheme={handleToggleTheme}
        onToggleMobileMenu={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        isMobileMenuOpen={isMobileMenuOpen}
        supabaseUserEmail={supabaseUserEmail}
        supabaseSyncState={syncState}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
      />

      <div className="flex-1 max-w-7xl w-full mx-auto flex">
        {/* Right Sidebar (in RTL, it is on the right) */}
        <Sidebar
          currentView={activeNavId}
          onNavigate={handleNavigate}
          selectedLevel={selectedLevel}
          settings={settings}
          stats={stats}
          isMobileOpen={isMobileMenuOpen}
          onCloseMobile={() => setIsMobileMenuOpen(false)}
        />

        {/* Main Content Area */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 min-w-0 pb-36">
          {currentView === 'home' && (
            <HomeView
              selectedLevel={selectedLevel}
              onSelectLevel={handleSelectLevel}
              activePassage={activePassage}
              recentPassages={passages}
              stats={stats}
              onNavigate={handleNavigate}
              onOpenPassageInReader={handleSelectPassage}
              onOpenManualText={handleOpenManualTextFromHome}
              savedWordsCount={savedWords.length}
            />
          )}

          {currentView === 'reader' && (
            <ReaderView
              passage={activePassage}
              settings={settings}
              onUpdateSettings={handleUpdateSettings}
              onSelectPassage={handleSelectPassage}
              initialTab={readerTab}
              onTabChange={setReaderTab}
            />
          )}

          {currentView === 'dictionary' && (
            <DictionaryView
              selectedLevel={selectedLevel}
              onRefreshWords={refreshWords}
            />
          )}

          {currentView === 'vocabulary' && (
            <VocabularyView
              savedWords={savedWords}
              onRefreshWords={refreshWords}
            />
          )}

          {currentView === 'history' && (
            <HistoryView
              passages={passages}
              onSelectPassage={handleSelectPassage}
              onRefreshPassages={refreshPassages}
              onNavigateToImport={() => handleNavigate('import')}
              supabaseUserEmail={supabaseUserEmail}
            />
          )}

          {currentView === 'settings' && (
            <SettingsView
              settings={settings}
              onUpdateSettings={handleUpdateSettings}
              onResetSettings={handleResetSettings}
              onDataCleared={() => {
                refreshPassages();
                refreshWords();
              }}
              supabaseConfigured={supabaseConfigured}
              supabaseUserEmail={supabaseUserEmail}
              supabaseSyncState={syncState}
              supabaseLastSyncedAt={lastSyncedAt}
              supabaseSyncError={syncError}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
              onSyncWithSupabase={handleSyncWithSupabase}
            />
          )}
        </main>
      </div>

      {/* Supabase Authentication Modal */}
      <SupabaseAuthModal
        isOpen={isAuthModalOpen}
        isConfigured={supabaseConfigured}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={handleSyncWithSupabase}
      />

      {/* Global Fixed Audio Player Bar */}
      <AudioPlayerBar
        totalSentences={activePassage?.sentences?.length || 0}
        currentSentenceIndex={activeSentenceIndex}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onToggleConcentrationMode={() =>
          handleUpdateSettings({ concentrationMode: !settings.concentrationMode })
        }
      />
    </div>
  );
}
