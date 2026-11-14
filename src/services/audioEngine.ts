import {
  AudioSourceStatus,
  ReadingSettings,
  VoiceGender,
} from '../types';
import { computeAudioHash, normalizeGermanText, splitTextIntoTtsChunks } from '../utils/audioHash';
import { stitchWordBlobsIntoSentence } from '../utils/audioStitcher';
import { indexedDbCache } from './indexedDbCache';
import { findAudioInSupabaseStorageByText } from './supabaseSync';
import {
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_FEMALE_VOICE_ID,
  DEFAULT_MALE_VOICE_ID,
  getAvailableElevenLabsVoices,
} from './elevenLabsVoices';

type AudioTierSource = 'local' | 'supabase' | 'elevenlabs';

interface ResolvedAudioItem {
  blob: Blob;
  source: AudioTierSource;
}

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'error';

type LastFailedAction =
  | { type: 'sentence'; index: number }
  | { type: 'word-seq'; sentenceIndex: number; wordIndex: number }
  | { type: 'word'; word: string }
  | null;

export function extractGermanWordsFromSentence(sentence: string): string[] {
  if (!sentence) return [];
  return sentence
    .split(/(\s+|[.,!?;:„"“»«()]+)/g)
    .filter(Boolean)
    .filter((tok) => /[a-zA-ZäöüÄÖÜß]/.test(tok))
    .map((tok) => tok.replace(/[.,!?;:„"“»«()]/g, '').trim())
    .filter(Boolean);
}

class AudioEngine {
  private audio: HTMLAudioElement | null = null;
  private wordAudio: HTMLAudioElement | null = null;
  private activeSentenceObjectUrl: string | null = null;
  private activeWordObjectUrl: string | null = null;

  private currentSentences: string[] = [];
  private activeSentenceIndex: number = -1;
  private activeWordIndex: number = -1;
  private currentSentenceWords: string[] = [];
  private state: PlaybackState = 'idle';
  private activeSourceStatus: AudioSourceStatus = 'Newly Generated ElevenLabs Audio';
  private settings: ReadingSettings;

  private timerId: any = null;
  private isWordPlaying: boolean = false;
  private pausedBeforeWord: boolean = false;
  private playbackSessionId: number = 0;

  private lastError: string | null = null;
  private lastFailedAction: LastFailedAction = null;

  // Multi-chunk / assembled blob playback queues
  private activeChunkQueue: string[] = [];
  private activeChunkIndex: number = 0;
  private activeBlobQueue: Blob[] = [];
  private activeBlobQueueIndex: number = 0;
  private inFlightResolves: Map<string, Promise<ResolvedAudioItem>> = new Map();

  // Listeners
  private stateListeners: Set<(state: PlaybackState) => void> = new Set();
  private sentenceListeners: Set<(index: number) => void> = new Set();
  private wordListeners: Set<(pos: { sentenceIndex: number; wordIndex: number }) => void> = new Set();
  private sourceListeners: Set<(status: AudioSourceStatus) => void> = new Set();
  private errorListeners: Set<(error: string) => void> = new Set();
  private finishListeners: Set<() => void> = new Set();

  constructor() {
    this.settings = {
      voice: 'Sarah (German Female)',
      voiceGender: 'female',
      elevenLabsVoiceId: DEFAULT_FEMALE_VOICE_ID,
      elevenLabsModel: DEFAULT_ELEVENLABS_MODEL,
      speed: 1.0,
      pitch: 0,
      defaultLevel: 'A2',
      readingMode: 'continuous',
      readingUnit: 'sentence',
      autoResumeAfterWord: false,
      autoScroll: true,
      sentencePauseMs: 350,
      paragraphPauseMs: 750,
      repeatMode: 'none',
      concentrationMode: false,
      timerMinutes: 0,
      theme: 'light',
    };

    if (typeof window !== 'undefined') {
      this.audio = new Audio();
      this.audio.onended = () => this.handleAudioChunkOrSentenceEnded();
      this.audio.onerror = () =>
        this.failPlayback(
          'تعذر تشغيل الملف الصوتي المسترجع من ElevenLabs.',
          { type: 'sentence', index: Math.max(0, this.activeSentenceIndex) }
        );

      this.wordAudio = new Audio();
      this.wordAudio.onended = () => this.handleWordEnded();
      this.wordAudio.onerror = () => {
        this.isWordPlaying = false;
      };
    }
  }

  public updateSettings(newSettings: Partial<ReadingSettings>): void {
    const oldVoiceId = this.getActiveVoiceId();
    const oldUnit = this.settings.readingUnit || 'sentence';
    this.settings = { ...this.settings, ...newSettings };
    const newUnit = this.settings.readingUnit || 'sentence';

    // Apply playbackRate live without re-fetching or invalidating cached MP3s
    if (this.audio) {
      this.audio.playbackRate = this.settings.speed;
    }
    if (this.wordAudio) {
      this.wordAudio.playbackRate = this.settings.speed;
    }

    const newVoiceId = this.getActiveVoiceId();
    if ((oldVoiceId !== newVoiceId || oldUnit !== newUnit) && this.state === 'playing') {
      this.play(this.activeSentenceIndex);
    } else if (oldUnit !== newUnit && newUnit === 'sentence') {
      this.activeWordIndex = -1;
      this.notifyWordChange(this.activeSentenceIndex, -1);
    }
  }

  public loadSentences(sentences: string[], startIndex: number = 0): void {
    this.stop();
    this.currentSentences = sentences;
    this.activeSentenceIndex = Math.max(0, Math.min(startIndex, Math.max(sentences.length - 1, 0)));
    this.activeWordIndex = -1;
    this.notifySentenceChange(this.activeSentenceIndex);
    this.notifyWordChange(this.activeSentenceIndex, -1);
  }

  public getState(): PlaybackState {
    return this.state;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public getCurrentIndex(): number {
    return this.activeSentenceIndex;
  }

  public getCurrentWordIndex(): number {
    return this.activeWordIndex;
  }

  public getSentences(): string[] {
    return this.currentSentences;
  }

  public getSourceStatus(): AudioSourceStatus {
    return this.activeSourceStatus;
  }

  public getActiveVoiceId(): string {
    if (this.settings.elevenLabsVoiceId) return this.settings.elevenLabsVoiceId;
    const live = getAvailableElevenLabsVoices();
    return this.settings.voiceGender === 'male'
      ? live.defaultMaleVoiceId || DEFAULT_MALE_VOICE_ID
      : live.defaultFemaleVoiceId || DEFAULT_FEMALE_VOICE_ID;
  }

  public getActiveVoiceGender(): VoiceGender {
    const id = this.getActiveVoiceId();
    const matched = getAvailableElevenLabsVoices().voices.find((v) => v.voiceId === id);
    if (matched) return matched.gender;
    return this.settings.voiceGender === 'male' ? 'male' : 'female';
  }

  public onStateChange(cb: (state: PlaybackState) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  public onSentenceChange(cb: (index: number) => void): () => void {
    this.sentenceListeners.add(cb);
    return () => this.sentenceListeners.delete(cb);
  }

  public onWordChange(
    cb: (pos: { sentenceIndex: number; wordIndex: number }) => void
  ): () => void {
    this.wordListeners.add(cb);
    return () => this.wordListeners.delete(cb);
  }

  public onSourceChange(cb: (status: AudioSourceStatus) => void): () => void {
    this.sourceListeners.add(cb);
    return () => this.sourceListeners.delete(cb);
  }

  public onError(cb: (error: string) => void): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  public onFinish(cb: () => void): () => void {
    this.finishListeners.add(cb);
    return () => this.finishListeners.delete(cb);
  }

  private setState(newState: PlaybackState): void {
    this.state = newState;
    this.stateListeners.forEach((cb) => cb(newState));
  }

  private setSourceStatus(status: AudioSourceStatus): void {
    this.activeSourceStatus = status;
    this.sourceListeners.forEach((cb) => cb(status));
  }

  private notifySentenceChange(index: number): void {
    this.sentenceListeners.forEach((cb) => cb(index));
  }

  private notifyWordChange(sentenceIndex: number, wordIndex: number): void {
    this.wordListeners.forEach((cb) => cb({ sentenceIndex, wordIndex }));
  }

  private emitError(msg: string): void {
    this.lastError = msg;
    this.errorListeners.forEach((cb) => cb(msg));
  }

  private failPlayback(message: string, action: LastFailedAction): void {
    this.clearTimers();
    this.playbackSessionId += 1;
    this.isWordPlaying = false;
    if (this.audio) {
      this.audio.pause();
    }
    if (this.wordAudio) {
      this.wordAudio.pause();
    }
    this.lastFailedAction = action;
    this.emitError(message);
    this.setState('error');
  }

  public async retryLast(): Promise<void> {
    const action = this.lastFailedAction;
    if (action?.type === 'word') {
      await this.playWordOnly(action.word);
      return;
    }
    if (action?.type === 'word-seq') {
      await this.playWordAt(action.sentenceIndex, action.wordIndex);
      return;
    }
    const idx = action?.type === 'sentence' ? action.index : Math.max(0, this.activeSentenceIndex);
    await this.play(idx);
  }

  private revokeSentenceObjectUrl(): void {
    if (this.activeSentenceObjectUrl) {
      URL.revokeObjectURL(this.activeSentenceObjectUrl);
      this.activeSentenceObjectUrl = null;
    }
  }

  private revokeWordObjectUrl(): void {
    if (this.activeWordObjectUrl) {
      URL.revokeObjectURL(this.activeWordObjectUrl);
      this.activeWordObjectUrl = null;
    }
  }

  // ----------------------------------------------------------------
  // CORE SENTENCE & WORD-BY-WORD PLAYBACK (ELEVENLABS ONLY)
  // ----------------------------------------------------------------
  public async play(index?: number): Promise<void> {
    if (this.currentSentences.length === 0) return;

    if ((this.settings.readingUnit || 'sentence') === 'word') {
      const targetSentence =
        typeof index === 'number' && index >= 0 && index < this.currentSentences.length
          ? index
          : Math.max(0, this.activeSentenceIndex);
      const startWord =
        typeof index === 'number' || this.activeWordIndex < 0 ? 0 : this.activeWordIndex;
      await this.playWordAt(targetSentence, startWord);
      return;
    }

    this.playbackSessionId += 1;
    const sessionId = this.playbackSessionId;
    this.clearTimers();
    this.lastError = null;
    this.activeWordIndex = -1;
    this.notifyWordChange(this.activeSentenceIndex, -1);

    if (this.isWordPlaying) {
      if (this.wordAudio) this.wordAudio.pause();
      this.isWordPlaying = false;
    }

    if (typeof index === 'number' && index >= 0 && index < this.currentSentences.length) {
      this.activeSentenceIndex = index;
    } else if (this.activeSentenceIndex < 0) {
      this.activeSentenceIndex = 0;
    }

    this.notifySentenceChange(this.activeSentenceIndex);
    this.notifyWordChange(this.activeSentenceIndex, -1);
    this.setState('loading');

    const sentence = this.currentSentences[this.activeSentenceIndex];
    if (!sentence) {
      this.setState('idle');
      return;
    }

    this.activeChunkQueue = splitTextIntoTtsChunks(sentence, 2800);
    this.activeChunkIndex = 0;
    this.activeBlobQueue = [];
    this.activeBlobQueueIndex = 0;
    if (this.activeChunkQueue.length === 0) {
      this.handleSentenceEnded();
      return;
    }

    await this.playSentenceWithWordReuse(this.activeChunkQueue[0], sessionId, {
      type: 'sentence',
      index: this.activeSentenceIndex,
    });
  }

  public async playWordAt(sentenceIndex: number, wordIndex: number): Promise<void> {
    if (this.currentSentences.length === 0) return;

    this.playbackSessionId += 1;
    const sessionId = this.playbackSessionId;
    this.clearTimers();
    this.lastError = null;

    if (this.isWordPlaying) {
      if (this.wordAudio) this.wordAudio.pause();
      this.isWordPlaying = false;
    }

    const safeSentIdx = Math.max(0, Math.min(sentenceIndex, this.currentSentences.length - 1));
    const sentenceChanged = this.activeSentenceIndex !== safeSentIdx;
    this.activeSentenceIndex = safeSentIdx;
    const words = extractGermanWordsFromSentence(this.currentSentences[safeSentIdx] || '');
    this.currentSentenceWords = words;

    if (sentenceChanged) {
      this.notifySentenceChange(safeSentIdx);
    }

    if (words.length === 0) {
      this.activeWordIndex = -1;
      this.notifyWordChange(safeSentIdx, -1);
      this.handleSentenceEnded();
      return;
    }

    const safeWordIdx = Math.max(0, Math.min(wordIndex, words.length - 1));
    this.activeWordIndex = safeWordIdx;
    this.notifyWordChange(safeSentIdx, safeWordIdx);
    this.setState('loading');

    this.activeChunkQueue = [words[safeWordIdx]];
    this.activeChunkIndex = 0;

    await this.playChunk(words[safeWordIdx], sessionId, false, {
      type: 'word-seq',
      sentenceIndex: safeSentIdx,
      wordIndex: safeWordIdx,
    });
  }

  /**
   * Resolves audio for a single word or text chunk using a strict 3-tier order:
   *   1. Browser IndexedDB local cache
   *   2. Supabase Storage (`german-learning/<userId>/audio/`) — avoids spending ElevenLabs tokens
   *   3. ElevenLabs TTS API (`/api/elevenlabs/tts`) — ONLY when absent from both caches
   */
  private async resolveTextAudio(
    text: string,
    mode: 'word' | 'sentence' = 'word'
  ): Promise<ResolvedAudioItem> {
    const normalized = normalizeGermanText(text);
    const voiceId = this.getActiveVoiceId();
    const voiceGender = this.getActiveVoiceGender();
    const model = this.settings.elevenLabsModel || DEFAULT_ELEVENLABS_MODEL;
    const dedupeKey = `${voiceId}|${model}|${mode}|${normalized}`;

    const existingPromise = this.inFlightResolves.get(dedupeKey);
    if (existingPromise) {
      return existingPromise;
    }

    const workPromise = (async (): Promise<ResolvedAudioItem> => {
      const { audioHash } = await computeAudioHash({
        text: normalized,
        language: 'de-DE',
        provider: 'elevenlabs',
        model,
        voiceId,
        audioFormat: 'mp3',
        cacheVersion: 1,
      });

      // TIER 1: Browser IndexedDB Persistent Local Cache
      const localRecord = await indexedDbCache.getAudio(audioHash);
      if (localRecord && (await this.isValidAudioBlob(localRecord.blob))) {
        return { blob: localRecord.blob, source: 'local' };
      } else if (localRecord) {
        await indexedDbCache.deleteAudio(audioHash).catch(() => {});
      }

      // TIER 2: Supabase Storage Audio Bucket (`<userId>/audio/`) — zero ElevenLabs tokens
      const cloudAudio = await findAudioInSupabaseStorageByText(normalized);
      if (cloudAudio && (await this.isValidAudioBlob(cloudAudio.blob))) {
        await indexedDbCache
          .putAudio({
            audioHash,
            blob: cloudAudio.blob,
            mimeType: cloudAudio.mimeType || 'audio/mpeg',
            text: normalized,
            voiceId,
            voiceGender,
            model,
            sourceType: 'ElevenLabs Audio',
          })
          .catch(() => {});
        return { blob: cloudAudio.blob, source: 'supabase' };
      }

      // TIER 3: Official ElevenLabs API via Vercel serverless endpoint (/api/elevenlabs/tts)
      const synthRes = await fetch('/api/elevenlabs/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: normalized,
          language: 'de-DE',
          model,
          voiceId,
          mode,
        }),
      });

      if (!synthRes.ok) {
        const errJson = await synthRes.json().catch(() => null);
        throw new Error(
          errJson?.error ||
            `فشل توليد الصوت عبر ElevenLabs (HTTP ${synthRes.status}). يرجى التحقق من الإعدادات وإعادة المحاولة.`
        );
      }

      const contentType = synthRes.headers.get('Content-Type') || '';
      if (!contentType.includes('audio')) {
        throw new Error('استجابة الخادم من ElevenLabs لا تحتوي على ملف صوتي صالح.');
      }

      const audioBlob = await synthRes.blob();
      if (!(await this.isValidAudioBlob(audioBlob))) {
        throw new Error('ملف الصوت MP3 المُعاد من ElevenLabs فارغ أو تالف.');
      }

      await indexedDbCache.putAudio({
        audioHash,
        blob: audioBlob,
        mimeType: 'audio/mpeg',
        text: normalized,
        voiceId,
        voiceGender,
        model,
        sourceType: 'ElevenLabs Audio',
      });

      return { blob: audioBlob, source: 'elevenlabs' };
    })().finally(() => {
      this.inFlightResolves.delete(dedupeKey);
    });

    this.inFlightResolves.set(dedupeKey, workPromise);
    return workPromise;
  }

  /**
   * Checks if the whole sentence already exists in IndexedDB or Supabase Storage;
   * otherwise resolves each word (IndexedDB -> Supabase -> ElevenLabs only for missing words)
   * and stitches them together into a continuous sentence audio buffer.
   */
  private async playSentenceWithWordReuse(
    sentenceText: string,
    sessionId: number,
    retryAction: LastFailedAction
  ): Promise<boolean> {
    if (sessionId !== this.playbackSessionId) return false;

    const voiceId = this.getActiveVoiceId();
    const voiceGender = this.getActiveVoiceGender();
    const model = this.settings.elevenLabsModel || DEFAULT_ELEVENLABS_MODEL;
    const normalizedSentence = normalizeGermanText(sentenceText);

    try {
      // Check whole sentence in IndexedDB first
      const { audioHash: sentenceHash } = await computeAudioHash({
        text: normalizedSentence,
        language: 'de-DE',
        provider: 'elevenlabs',
        model,
        voiceId,
        audioFormat: 'mp3',
        cacheVersion: 1,
      });
      if (sessionId !== this.playbackSessionId) return false;

      const localSentence = await indexedDbCache.getAudio(sentenceHash);
      if (sessionId !== this.playbackSessionId) return false;
      if (localSentence && (await this.isValidAudioBlob(localSentence.blob))) {
        this.setSourceStatus('Local Cached Audio');
        return await this.playBlobInElement(localSentence.blob, false, sessionId, retryAction);
      }

      // Check whole sentence in Supabase Storage next
      const cloudSentence = await findAudioInSupabaseStorageByText(normalizedSentence);
      if (sessionId !== this.playbackSessionId) return false;
      if (cloudSentence && (await this.isValidAudioBlob(cloudSentence.blob))) {
        await indexedDbCache
          .putAudio({
            audioHash: sentenceHash,
            blob: cloudSentence.blob,
            mimeType: cloudSentence.mimeType || 'audio/mpeg',
            text: normalizedSentence,
            voiceId,
            voiceGender,
            model,
            sourceType: 'ElevenLabs Audio',
          })
          .catch(() => {});
        this.setSourceStatus('Supabase Cloud Audio');
        return await this.playBlobInElement(cloudSentence.blob, false, sessionId, retryAction);
      }

      // Extract words -> check IndexedDB & Supabase Storage for each word before generating missing ones
      const words = extractGermanWordsFromSentence(normalizedSentence);
      if (words.length <= 1) {
        const singleTarget = words[0] || normalizedSentence;
        return await this.playChunk(singleTarget, sessionId, false, retryAction);
      }

      const uniqueWords = Array.from(new Set(words));
      const resolvedMap = new Map<string, ResolvedAudioItem>();
      let usedElevenLabs = false;
      let usedSupabase = false;

      const concurrency = 3;
      let nextIdx = 0;
      const runWorker = async () => {
        while (nextIdx < uniqueWords.length) {
          if (sessionId !== this.playbackSessionId) return;
          const current = uniqueWords[nextIdx++];
          const item = await this.resolveTextAudio(current, 'word');
          resolvedMap.set(current, item);
          if (item.source === 'elevenlabs') usedElevenLabs = true;
          else if (item.source === 'supabase') usedSupabase = true;
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(concurrency, uniqueWords.length) }, () => runWorker())
      );
      if (sessionId !== this.playbackSessionId) return false;

      this.setSourceStatus(
        usedElevenLabs
          ? 'Newly Generated ElevenLabs Audio'
          : usedSupabase
          ? 'Supabase Cloud Audio'
          : 'Local Cached Audio'
      );

      const orderedWordBlobs = words.map((w) => resolvedMap.get(w)!.blob);
      const stitchedBlob = await stitchWordBlobsIntoSentence(orderedWordBlobs, 60);
      if (sessionId !== this.playbackSessionId) return false;

      if (stitchedBlob) {
        this.activeBlobQueue = [];
        this.activeBlobQueueIndex = 0;
        return await this.playBlobInElement(stitchedBlob, false, sessionId, retryAction);
      }

      // Safe fallback if Web Audio stitching is unavailable: play resolved word blobs sequentially
      this.activeBlobQueue = orderedWordBlobs;
      this.activeBlobQueueIndex = 0;
      return await this.playBlobInElement(orderedWordBlobs[0], false, sessionId, retryAction);
    } catch (err: any) {
      if (sessionId !== this.playbackSessionId) return false;
      this.failPlayback(
        err?.message || 'تعذر تجهيز أو تشغيل الجملة الصوتية.',
        retryAction
      );
      return false;
    }
  }

  private async playChunk(
    chunkText: string,
    sessionId: number,
    isWord: boolean,
    retryAction: LastFailedAction
  ): Promise<boolean> {
    if (sessionId !== this.playbackSessionId) return false;

    try {
      const wordCount = chunkText.trim().split(/\s+/).filter(Boolean).length;
      const mode: 'word' | 'sentence' = isWord || wordCount <= 2 ? 'word' : 'sentence';
      const resolved = await this.resolveTextAudio(chunkText, mode);
      if (sessionId !== this.playbackSessionId) return false;

      if (resolved.source === 'local') {
        this.setSourceStatus('Local Cached Audio');
      } else if (resolved.source === 'supabase') {
        this.setSourceStatus('Supabase Cloud Audio');
      } else {
        this.setSourceStatus('Newly Generated ElevenLabs Audio');
      }

      return await this.playBlobInElement(resolved.blob, isWord, sessionId, retryAction);
    } catch (err: any) {
      if (sessionId !== this.playbackSessionId) return false;
      this.failPlayback(
        err?.message
          ? err.message
          : 'تعذر الاتصال بخدمة ElevenLabs لتوليد الصوت. تحقق من الاتصال وأعد المحاولة.',
        retryAction
      );
      return false;
    }
  }

  private async isValidAudioBlob(blob: Blob): Promise<boolean> {
    if (!blob || blob.size < 64) return false;
    try {
      const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
      if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return true; // MP3 ID3
      if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return true; // MPEG/ADTS sync
      if (
        head.length >= 12 &&
        head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
        head[8] === 0x57 && head[9] === 0x41 && head[10] === 0x56 && head[11] === 0x45
      ) {
        return true; // RIFF/WAVE
      }
      if (head.length >= 8 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) {
        return true; // M4A/MP4 ftyp
      }
      if (head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53) return true; // OggS
      if (head[0] === 0x66 && head[1] === 0x4c && head[2] === 0x61 && head[3] === 0x43) return true; // fLaC
      if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true; // WebM
      return (blob.type || '').toLowerCase().startsWith('audio/');
    } catch {
      return false;
    }
  }

  private async playBlobInElement(
    blob: Blob,
    isWord: boolean,
    sessionId: number,
    retryAction: LastFailedAction
  ): Promise<boolean> {
    if (sessionId !== this.playbackSessionId) return false;
    const url = URL.createObjectURL(blob);
    if (isWord) {
      this.revokeWordObjectUrl();
      this.activeWordObjectUrl = url;
    } else {
      this.revokeSentenceObjectUrl();
      this.activeSentenceObjectUrl = url;
    }
    return await this.playUrlInElement(url, isWord, sessionId, retryAction);
  }

  private async playUrlInElement(
    url: string,
    isWord: boolean,
    sessionId: number,
    retryAction: LastFailedAction
  ): Promise<boolean> {
    if (sessionId !== this.playbackSessionId) return false;
    const target = isWord ? this.wordAudio : this.audio;
    if (!target) {
      this.failPlayback('مشغل الصوت غير متاح في المتصفح.', retryAction);
      return false;
    }

    const rate = this.settings.speed || 1.0;
    target.pause();
    target.src = url;
    // Loading a new src resets playbackRate to defaultPlaybackRate, so set both.
    target.defaultPlaybackRate = rate;
    target.playbackRate = rate;

    try {
      await target.play();
      if (!isWord) {
        this.lastFailedAction = null;
        this.lastError = null;
        this.setState('playing');
      }
      return true;
    } catch (err: any) {
      this.failPlayback(
        err?.name === 'NotAllowedError'
          ? 'حظر المتصفح التشغيل التلقائي للصوت. اضغط على زر التشغيل أو إعادة المحاولة.'
          : 'تعذر تشغيل الصوت المُولَّد من ElevenLabs في المتصفح.',
        retryAction
      );
      return false;
    }
  }

  private async handleAudioChunkOrSentenceEnded(): Promise<void> {
    if ((this.settings.readingUnit || 'sentence') === 'word') {
      const nextWordIdx = this.activeWordIndex + 1;
      if (nextWordIdx < this.currentSentenceWords.length) {
        this.timerId = setTimeout(() => {
          this.playWordAt(this.activeSentenceIndex, nextWordIdx);
        }, 220);
        return;
      }
      // Finished all words in the current sentence
      this.handleSentenceEnded();
      return;
    }

    if (this.activeBlobQueueIndex + 1 < this.activeBlobQueue.length) {
      this.activeBlobQueueIndex += 1;
      const nextBlob = this.activeBlobQueue[this.activeBlobQueueIndex];
      await this.playBlobInElement(nextBlob, false, this.playbackSessionId, {
        type: 'sentence',
        index: this.activeSentenceIndex,
      });
      return;
    }

    if (this.activeChunkIndex + 1 < this.activeChunkQueue.length) {
      this.activeChunkIndex += 1;
      const nextChunk = this.activeChunkQueue[this.activeChunkIndex];
      await this.playSentenceWithWordReuse(nextChunk, this.playbackSessionId, {
        type: 'sentence',
        index: this.activeSentenceIndex,
      });
      return;
    }
    this.handleSentenceEnded();
  }

  public pause(): void {
    this.clearTimers();

    if (this.audio && !this.audio.paused) {
      this.audio.pause();
    }
    this.setState('paused');
  }

  public resume(): void {
    if (this.state === 'paused') {
      if (this.audio && this.audio.src && this.audio.paused && this.audio.currentTime > 0) {
        this.audio
          .play()
          .then(() => this.setState('playing'))
          .catch(() => this.play(this.activeSentenceIndex));
        return;
      }
      if ((this.settings.readingUnit || 'sentence') === 'word' && this.activeWordIndex >= 0) {
        this.playWordAt(this.activeSentenceIndex, this.activeWordIndex);
        return;
      }
    }
    this.play(this.activeSentenceIndex);
  }

  public stop(): void {
    this.playbackSessionId += 1;
    this.clearTimers();
    this.activeChunkQueue = [];
    this.activeChunkIndex = 0;
    this.activeBlobQueue = [];
    this.activeBlobQueueIndex = 0;
    this.activeWordIndex = -1;
    this.currentSentenceWords = [];

    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
    if (this.wordAudio) {
      this.wordAudio.pause();
      this.wordAudio.currentTime = 0;
    }
    this.revokeSentenceObjectUrl();
    this.revokeWordObjectUrl();

    this.isWordPlaying = false;
    this.notifyWordChange(this.activeSentenceIndex, -1);
    this.setState('stopped');
  }

  public nextSentence(): void {
    this.activeWordIndex = 0;
    if (this.activeSentenceIndex < this.currentSentences.length - 1) {
      this.play(this.activeSentenceIndex + 1);
    } else if (this.settings.repeatMode === 'all') {
      this.play(0);
    } else {
      this.stop();
      this.finishListeners.forEach((cb) => cb());
    }
  }

  public prevSentence(): void {
    this.activeWordIndex = 0;
    if (this.activeSentenceIndex > 0) {
      this.play(this.activeSentenceIndex - 1);
    } else {
      this.play(0);
    }
  }

  public repeatCurrentSentence(): void {
    this.activeWordIndex = 0;
    this.play(this.activeSentenceIndex);
  }

  private handleSentenceEnded(): void {
    if (this.settings.repeatMode === 'sentence') {
      this.repeatCurrentSentence();
      return;
    }

    if (this.settings.readingMode === 'sentence-step') {
      this.activeWordIndex = 0;
      this.notifyWordChange(this.activeSentenceIndex, -1);
      this.setState('paused');
      return;
    }

    const pauseTime = this.settings.sentencePauseMs || 350;
    this.timerId = setTimeout(() => {
      this.nextSentence();
    }, pauseTime);
  }

  // ----------------------------------------------------------------
  // INDIVIDUAL WORD PRONUNCIATION (CLICK-TO-PRONOUNCE — ELEVENLABS ONLY)
  // ----------------------------------------------------------------
  public playWordOnly(word: string): Promise<boolean> {
    return new Promise((resolve) => {
      const cleanWord = word.trim().replace(/[.,!?;:„"“»«()]/g, '');
      if (!cleanWord) {
        resolve(false);
        return;
      }

      if (this.state === 'playing') {
        this.pausedBeforeWord = true;
        if (this.audio) this.audio.pause();
        if (this.timerId) clearTimeout(this.timerId);
      } else {
        this.pausedBeforeWord = false;
      }

      this.isWordPlaying = true;
      const wordSession = ++this.playbackSessionId;

      if (this.wordAudio) {
        this.wordAudio.onended = () => {
          this.handleWordEnded();
          resolve(true);
        };
        this.wordAudio.onerror = () => {
          this.failPlayback('تعذر تشغيل صوت الكلمة المُسترجع من ElevenLabs.', {
            type: 'word',
            word: cleanWord,
          });
          resolve(false);
        };
      }

      this.playChunk(cleanWord, wordSession, true, { type: 'word', word: cleanWord })
        .then((ok) => {
          if (!ok) {
            this.isWordPlaying = false;
            resolve(false);
          }
        })
        .catch(() => {
          this.isWordPlaying = false;
          resolve(false);
        });
    });
  }

  private handleWordEnded(): void {
    this.isWordPlaying = false;
    this.revokeWordObjectUrl();
    if (this.settings.autoResumeAfterWord && this.pausedBeforeWord) {
      this.resume();
    } else if (this.pausedBeforeWord) {
      this.setState('paused');
    }
  }

  private clearTimers(): void {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}

export const audioEngine = new AudioEngine();
