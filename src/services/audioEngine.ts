import {
  AudioSourceStatus,
  ReadingSettings,
  VoiceGender,
} from '../types';
import { computeAudioHash, splitTextIntoTtsChunks } from '../utils/audioHash';
import { indexedDbCache } from './indexedDbCache';
import {
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_FEMALE_VOICE_ID,
  DEFAULT_MALE_VOICE_ID,
  VERIFIED_ELEVENLABS_VOICES,
} from './elevenLabsVoices';

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'error';

type LastFailedAction =
  | { type: 'sentence'; index: number }
  | { type: 'word'; word: string }
  | null;

async function isValidMp3Blob(blob: Blob): Promise<boolean> {
  if (!blob || blob.size < 128) return false;
  try {
    const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    // ID3 tag ("ID3")
    if (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) return true;
    // MPEG audio frame sync
    if (header[0] === 0xff && (header[1] & 0xe0) === 0xe0) return true;
    return false;
  } catch {
    return false;
  }
}

class AudioEngine {
  private audio: HTMLAudioElement | null = null;
  private wordAudio: HTMLAudioElement | null = null;
  private activeSentenceObjectUrl: string | null = null;
  private activeWordObjectUrl: string | null = null;

  private currentSentences: string[] = [];
  private activeSentenceIndex: number = -1;
  private state: PlaybackState = 'idle';
  private activeSourceStatus: AudioSourceStatus = 'Newly Generated ElevenLabs Audio';
  private settings: ReadingSettings;

  private timerId: any = null;
  private isWordPlaying: boolean = false;
  private pausedBeforeWord: boolean = false;
  private playbackSessionId: number = 0;

  private lastError: string | null = null;
  private lastFailedAction: LastFailedAction = null;

  // Multi-chunk playback state (for long sentences/paragraphs > 2800 chars)
  private activeChunkQueue: string[] = [];
  private activeChunkIndex: number = 0;

  // Listeners
  private stateListeners: Set<(state: PlaybackState) => void> = new Set();
  private sentenceListeners: Set<(index: number) => void> = new Set();
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
    this.settings = { ...this.settings, ...newSettings };

    // Apply playbackRate live without re-fetching or invalidating cached MP3s
    if (this.audio) {
      this.audio.playbackRate = this.settings.speed;
    }
    if (this.wordAudio) {
      this.wordAudio.playbackRate = this.settings.speed;
    }

    const newVoiceId = this.getActiveVoiceId();
    if (oldVoiceId !== newVoiceId && this.state === 'playing') {
      this.play(this.activeSentenceIndex);
    }
  }

  public loadSentences(sentences: string[], startIndex: number = 0): void {
    this.stop();
    this.currentSentences = sentences;
    this.activeSentenceIndex = Math.max(0, Math.min(startIndex, Math.max(sentences.length - 1, 0)));
    this.notifySentenceChange(this.activeSentenceIndex);
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

  public getSentences(): string[] {
    return this.currentSentences;
  }

  public getSourceStatus(): AudioSourceStatus {
    return this.activeSourceStatus;
  }

  public getActiveVoiceId(): string {
    if (this.settings.elevenLabsVoiceId) return this.settings.elevenLabsVoiceId;
    return this.settings.voiceGender === 'male' ? DEFAULT_MALE_VOICE_ID : DEFAULT_FEMALE_VOICE_ID;
  }

  public getActiveVoiceGender(): VoiceGender {
    const id = this.getActiveVoiceId();
    const matched = VERIFIED_ELEVENLABS_VOICES.find((v) => v.voiceId === id);
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
  // CORE SENTENCE & LONG-TEXT CHUNK PLAYBACK (ELEVENLABS ONLY)
  // ----------------------------------------------------------------
  public async play(index?: number): Promise<void> {
    if (this.currentSentences.length === 0) return;

    this.playbackSessionId += 1;
    const sessionId = this.playbackSessionId;
    this.clearTimers();
    this.lastError = null;

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
    this.setState('loading');

    const sentence = this.currentSentences[this.activeSentenceIndex];
    if (!sentence) {
      this.setState('idle');
      return;
    }

    this.activeChunkQueue = splitTextIntoTtsChunks(sentence, 2800);
    this.activeChunkIndex = 0;
    if (this.activeChunkQueue.length === 0) {
      this.handleSentenceEnded();
      return;
    }

    await this.playChunk(this.activeChunkQueue[0], sessionId, false, {
      type: 'sentence',
      index: this.activeSentenceIndex,
    });
  }

  private async playChunk(
    chunkText: string,
    sessionId: number,
    isWord: boolean,
    retryAction: LastFailedAction
  ): Promise<boolean> {
    if (sessionId !== this.playbackSessionId) return false;

    const voiceId = this.getActiveVoiceId();
    const voiceGender = this.getActiveVoiceGender();
    const model = this.settings.elevenLabsModel || DEFAULT_ELEVENLABS_MODEL;

    const { audioHash } = await computeAudioHash({
      text: chunkText,
      language: 'de-DE',
      provider: 'elevenlabs',
      model,
      voiceId,
      audioFormat: 'mp3',
      cacheVersion: 1,
    });

    // TIER 1: Browser IndexedDB Persistent Local Cache (verified MP3)
    const localRecord = await indexedDbCache.getAudio(audioHash);
    if (sessionId !== this.playbackSessionId) return false;

    if (localRecord && (await isValidMp3Blob(localRecord.blob))) {
      this.setSourceStatus('Local Cached Audio');
      return await this.playBlobInElement(localRecord.blob, isWord, sessionId, retryAction);
    } else if (localRecord) {
      await indexedDbCache.deleteAudio(audioHash).catch(() => {});
    }

    // TIER 2: Official ElevenLabs API via secure server endpoint (ONLY TTS provider)
    try {
      const synthRes = await fetch('/api/tts/synthesize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: chunkText,
          language: 'de-DE',
          model,
          voiceId,
        }),
      });

      if (sessionId !== this.playbackSessionId) return false;

      if (!synthRes.ok) {
        const errJson = await synthRes.json().catch(() => null);
        const errMsg =
          errJson?.error ||
          `فشل توليد الصوت عبر ElevenLabs (HTTP ${synthRes.status}). يرجى التحقق من الإعدادات وإعادة المحاولة.`;
        this.failPlayback(errMsg, retryAction);
        return false;
      }

      const contentType = synthRes.headers.get('Content-Type') || '';
      if (!contentType.includes('audio')) {
        this.failPlayback('استجابة الخادم من ElevenLabs لا تحتوي على ملف صوتي صالح.', retryAction);
        return false;
      }

      const blob = await synthRes.blob();
      if (sessionId !== this.playbackSessionId) return false;

      if (!(await isValidMp3Blob(blob))) {
        this.failPlayback('ملف الصوت المُعاد من ElevenLabs فارغ أو تالف.', retryAction);
        return false;
      }

      await indexedDbCache.putAudio({
        audioHash,
        blob,
        mimeType: 'audio/mpeg',
        text: chunkText,
        voiceId,
        voiceGender,
        model,
        sourceType: 'ElevenLabs Audio',
      });

      this.setSourceStatus('Newly Generated ElevenLabs Audio');
      return await this.playBlobInElement(blob, isWord, sessionId, retryAction);
    } catch (err: any) {
      if (sessionId !== this.playbackSessionId) return false;
      this.failPlayback(
        err?.message || 'تعذر الاتصال بخدمة ElevenLabs لتوليد الصوت. تحقق من الاتصال وأعد المحاولة.',
        retryAction
      );
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

    target.pause();
    target.src = url;
    target.playbackRate = this.settings.speed || 1.0;

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
    if (this.activeChunkIndex + 1 < this.activeChunkQueue.length) {
      this.activeChunkIndex += 1;
      const nextChunk = this.activeChunkQueue[this.activeChunkIndex];
      await this.playChunk(nextChunk, this.playbackSessionId, false, {
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
    }
    this.play(this.activeSentenceIndex);
  }

  public stop(): void {
    this.playbackSessionId += 1;
    this.clearTimers();
    this.activeChunkQueue = [];
    this.activeChunkIndex = 0;

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
    this.setState('stopped');
  }

  public nextSentence(): void {
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
    if (this.activeSentenceIndex > 0) {
      this.play(this.activeSentenceIndex - 1);
    } else {
      this.play(0);
    }
  }

  public repeatCurrentSentence(): void {
    this.play(this.activeSentenceIndex);
  }

  private handleSentenceEnded(): void {
    if (this.settings.repeatMode === 'sentence') {
      this.repeatCurrentSentence();
      return;
    }

    if (this.settings.readingMode === 'sentence-step') {
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
