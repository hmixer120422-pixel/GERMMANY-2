import {
  GermanTextPassage,
  ListeningStats,
  ReadingHistoryEntry,
  ReadingSettings,
  SavedWord,
  SupabaseStorageFileItem,
  SupabaseSyncState,
} from '../types';
import {
  getSupabaseClientSync,
  initSupabaseClient,
  SUPABASE_STORAGE_BUCKET,
} from './supabaseClient';
import { IndexedDbAudioRecord } from './indexedDbCache';
import { buildAudioFileNameFromText, dedupeAudioFileName } from '../utils/audioHash';
import {
  detectActualMimeType,
  getAlternateAudioMimeType,
  isAudioFileNameOrMime,
  preserveUploadFilename,
  SUPABASE_AUDIO_BUCKET_SQL,
} from '../utils/audioMime';

export { SUPABASE_AUDIO_BUCKET_SQL };

type SyncListener = (status: {
  state: SupabaseSyncState;
  lastSyncedAt: string | null;
  error: string | null;
}) => void;

let syncState: SupabaseSyncState = 'idle';
let lastSyncedAt: string | null = null;
let lastSyncError: string | null = null;
const syncListeners = new Set<SyncListener>();

function notifySync(nextState: SupabaseSyncState, errorMsg: string | null = null): void {
  syncState = nextState;
  lastSyncError = errorMsg;
  if (nextState === 'synced') {
    lastSyncedAt = new Date().toISOString();
  }
  const snapshot = { state: syncState, lastSyncedAt, error: lastSyncError };
  syncListeners.forEach((cb) => cb(snapshot));
}

export function onSupabaseSyncChange(cb: SyncListener): () => void {
  syncListeners.add(cb);
  cb({ state: syncState, lastSyncedAt, error: lastSyncError });
  return () => syncListeners.delete(cb);
}

export function getSupabaseSyncStatus() {
  return { state: syncState, lastSyncedAt, error: lastSyncError };
}

async function getAuthedContext() {
  const client = getSupabaseClientSync() || (await initSupabaseClient());
  if (!client) return null;
  const { data } = await client.auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  return { client, user };
}

function sanitizeStorageFileName(fileName: string): string {
  return preserveUploadFilename(fileName || 'document.txt').preservedName;
}

function isInvalidStorageKeyError(message: string): boolean {
  const lower = (message || '').toLowerCase();
  return lower.includes('invalid key') || lower.includes('invalidkey') || lower.includes('key is invalid');
}

export function isBucketMimeConfigError(message: string): boolean {
  const lower = (message || '').toLowerCase();
  return (
    lower.includes('mime') ||
    lower.includes('content type') ||
    lower.includes('not supported') ||
    lower.includes('allowed_mime_types')
  );
}

function formatSupabaseUploadError(fileName: string, rawMessage: string, mimeType: string): string {
  if (isBucketMimeConfigError(rawMessage)) {
    return `فشل رفع «${fileName}»: ${rawMessage} — حاوية "${SUPABASE_STORAGE_BUCKET}" في Supabase لا تسمح بعد بالصيغة (${mimeType}). يرجى تشغيل ملف SQL: supabase/update_audio_mime_types.sql داخل SQL Editor في لوحة Supabase.`;
  }
  return `فشل رفع «${fileName}»: ${rawMessage}`;
}

// =============================================================
// SUPABASE STORAGE API (`german-learning` private bucket)
// =============================================================

export async function uploadFileToSupabaseStorage(file: File): Promise<{
  storagePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  skippedExisting?: boolean;
} | null> {
  const ctx = await getAuthedContext();
  if (!ctx) return null;

  const detectedMime = await detectActualMimeType(file, file.name);
  const isAudio = isAudioFileNameOrMime(file.name, detectedMime);
  const { preservedName, asciiFallbackName } = preserveUploadFilename(file.name || 'document.txt');

  // If this is an audio file and the word/phrase already exists in Supabase Storage, skip re-uploading
  if (isAudio) {
    const byStem = await getAudioIndexMap(ctx, { forceRefresh: true });
    const existing = findMatchingAudioEntryInMap(byStem, file.name);
    if (existing) {
      return {
        storagePath: existing.path,
        fileName: existing.name,
        fileSize: existing.size || file.size,
        mimeType: existing.mimeType || detectedMime,
        skippedExisting: true,
      };
    }
  }

  const buildPath = (name: string) =>
    isAudio ? `${ctx.user.id}/audio/${name}` : `${ctx.user.id}/${Date.now()}_${name}`;

  const tryUpload = async (path: string, contentType: string, upsert: boolean) => {
    const { error } = await ctx.client.storage
      .from(SUPABASE_STORAGE_BUCKET)
      .upload(path, file, {
        cacheControl: '3600',
        upsert,
        contentType,
      });
    return error;
  };

  let activePath = buildPath(preservedName);
  let usedMime = detectedMime;
  let uploadErr = await tryUpload(activePath, usedMime, isAudio);

  // If storage backend enforces strict ASCII object keys, retry with deterministic ASCII fallback
  if (uploadErr && isInvalidStorageKeyError(uploadErr.message) && asciiFallbackName !== preservedName) {
    activePath = buildPath(asciiFallbackName);
    uploadErr = await tryUpload(activePath, usedMime, isAudio);
  }

  // If primary audio MIME alias is rejected (e.g. audio/mp4 vs audio/x-m4a), try canonical alias
  const altMime = isAudio ? getAlternateAudioMimeType(usedMime) : null;
  if (uploadErr && altMime && isBucketMimeConfigError(uploadErr.message)) {
    const altErr = await tryUpload(activePath, altMime, isAudio);
    if (!altErr) {
      usedMime = altMime;
      uploadErr = null;
    }
  }

  // Fallback for older RLS policies that allow INSERT on storage.objects without UPDATE (needed by upsert: true)
  if (
    uploadErr &&
    isAudio &&
    (uploadErr.message.toLowerCase().includes('row-level security') ||
      uploadErr.message.toLowerCase().includes('policy'))
  ) {
    const dot = preservedName.lastIndexOf('.');
    const base = dot > 0 ? preservedName.slice(0, dot) : preservedName;
    const ext = dot > 0 ? preservedName.slice(dot) : '';
    const insertPath = buildPath(`${base}_${Date.now()}${ext}`);
    const insertErr = await tryUpload(insertPath, usedMime, false);
    if (!insertErr) {
      activePath = insertPath;
      uploadErr = null;
    }
  }

  if (uploadErr) {
    throw new Error(formatSupabaseUploadError(file.name, uploadErr.message, usedMime));
  }

  if (isAudio) {
    invalidateSupabaseAudioIndexCache();
  }

  return {
    storagePath: activePath,
    fileName: file.name || preservedName,
    fileSize: file.size,
    mimeType: usedMime,
    skippedExisting: false,
  };
}

async function listAllAudioItemsFromBucket(
  ctx: NonNullable<Awaited<ReturnType<typeof getAuthedContext>>>,
  displayPrefix = ''
): Promise<SupabaseStorageFileItem[]> {
  const prefix = `${ctx.user.id}/audio`;
  const pageSize = 500;
  const collected: SupabaseStorageFileItem[] = [];

  for (let page = 0; page < 4; page++) {
    const { data, error } = await ctx.client.storage.from(SUPABASE_STORAGE_BUCKET).list(prefix, {
      limit: pageSize,
      offset: page * pageSize,
      sortBy: { column: 'created_at', order: 'desc' },
    });

    if (error || !data || data.length === 0) break;

    for (const item of data) {
      if (!item.name || item.name === '.emptyFolderPlaceholder' || item.id === null) continue;
      collected.push({
        name: displayPrefix ? `${displayPrefix}${item.name}` : item.name,
        path: `${prefix}/${item.name}`,
        id: item.id || undefined,
        size: Number((item.metadata as any)?.size || 0),
        mimeType: (item.metadata as any)?.mimetype || undefined,
        createdAt: item.created_at || undefined,
        updatedAt: item.updated_at || undefined,
      });
    }

    if (data.length < pageSize) break;
  }

  return collected;
}

export async function listUserFilesFromSupabaseStorage(): Promise<SupabaseStorageFileItem[]> {
  const ctx = await getAuthedContext();
  if (!ctx) return [];

  const [rootRes, audioFiles] = await Promise.all([
    ctx.client.storage.from(SUPABASE_STORAGE_BUCKET).list(ctx.user.id, {
      limit: 100,
      offset: 0,
      sortBy: { column: 'created_at', order: 'desc' },
    }),
    listAllAudioItemsFromBucket(ctx, 'audio/').catch(() => [] as SupabaseStorageFileItem[]),
  ]);

  if (rootRes.error) {
    throw new Error(`تعذر جلب قائمة الملفات من Supabase Storage: ${rootRes.error.message}`);
  }

  const rootFiles: SupabaseStorageFileItem[] = (rootRes.data || [])
    .filter((item) => item.name && item.name !== '.emptyFolderPlaceholder' && item.id !== null)
    .map((item) => ({
      name: item.name,
      path: `${ctx.user.id}/${item.name}`,
      id: item.id || undefined,
      size: Number((item.metadata as any)?.size || 0),
      mimeType: (item.metadata as any)?.mimetype || undefined,
      createdAt: item.created_at || undefined,
      updatedAt: item.updated_at || undefined,
    }));

  return [...rootFiles, ...audioFiles].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
}

export async function downloadFileFromSupabaseStorage(
  storagePath: string,
  suggestedName?: string
): Promise<Blob> {
  const ctx = await getAuthedContext();
  if (!ctx) {
    throw new Error('يجب تسجيل الدخول لتحميل الملفات من السحابة.');
  }

  const { data, error } = await ctx.client.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .download(storagePath);

  if (error || !data) {
    throw new Error(`تعذر تحميل الملف: ${error?.message || 'غير موجود'}`);
  }

  if (typeof window !== 'undefined') {
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName || storagePath.split('/').pop() || 'german-document';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return data;
}

/**
 * Downloads an audio file from the private `german-learning` Supabase Storage bucket
 * and ensures the returned Blob carries the true detected audio MIME type so HTMLAudioElement
 * can play MP3, WAV, M4A, OGG, WEBM, AAC, and FLAC directly.
 */
export async function fetchPlayableAudioFromSupabaseStorage(
  storagePath: string,
  fileName?: string,
  mimeHint?: string
): Promise<{ blob: Blob; mimeType: string }> {
  const ctx = await getAuthedContext();
  if (!ctx) {
    throw new Error('يجب تسجيل الدخول لتشغيل الملفات الصوتية من السحابة.');
  }

  const { data, error } = await ctx.client.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .download(storagePath);

  if (error || !data) {
    throw new Error(`تعذر تحميل الملف الصوتي: ${error?.message || 'غير موجود'}`);
  }

  const detectedMime = await detectActualMimeType(data, fileName || storagePath);
  const resolvedMime =
    detectedMime && detectedMime !== 'application/octet-stream'
      ? detectedMime
      : mimeHint || 'audio/mpeg';

  const typedBlob =
    data.type === resolvedMime ? data : new Blob([data], { type: resolvedMime });

  return {
    blob: typedBlob,
    mimeType: resolvedMime,
  };
}

export async function deleteFileFromSupabaseStorage(storagePath: string): Promise<void> {
  const ctx = await getAuthedContext();
  if (!ctx || !storagePath) return;

  const { error } = await ctx.client.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .remove([storagePath]);

  if (error) {
    throw new Error(`تعذر حذف الملف من Supabase Storage: ${error.message}`);
  }

  invalidateSupabaseAudioIndexCache();
}

/**
 * Verifies authenticated Supabase session + private `german-learning` Storage upload, list, download & delete.
 */
export async function testSupabaseStorageConnection(): Promise<{
  userId: string;
  email: string;
  bucket: string;
  uploadedPath: string;
  verifiedBytes: number;
}> {
  const ctx = await getAuthedContext();
  if (!ctx) {
    throw new Error('يرجى تسجيل الدخول بحساب Supabase أولاً لاختبار المصادقة والتخزين.');
  }

  const probeText = `Deutsch Meister Supabase Verification (${new Date().toISOString()})`;
  const probeFileName = `_verify_${Date.now()}.txt`;
  const probePath = `${ctx.user.id}/${probeFileName}`;
  const probeBlob = new Blob([probeText], { type: 'text/plain' });

  const { error: uploadErr } = await ctx.client.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .upload(probePath, probeBlob, {
      contentType: 'text/plain',
      upsert: false,
    });
  if (uploadErr) {
    throw new Error(`فشل الرفع إلى حاوية ${SUPABASE_STORAGE_BUCKET}: ${uploadErr.message}`);
  }

  const { data: listData, error: listErr } = await ctx.client.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .list(ctx.user.id, { search: probeFileName });
  if (listErr || !listData?.some((f) => f.name === probeFileName)) {
    throw new Error(`فشل التحقق من قائمة الملفات في ${SUPABASE_STORAGE_BUCKET}: ${listErr?.message || 'غير ظاهر'}`);
  }

  const { data: downloadedBlob, error: dlErr } = await ctx.client.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .download(probePath);
  if (dlErr || !downloadedBlob) {
    throw new Error(`فشل تنزيل الملف من ${SUPABASE_STORAGE_BUCKET}: ${dlErr?.message || 'غير متاح'}`);
  }

  const downloadedText = await downloadedBlob.text();
  if (downloadedText !== probeText) {
    throw new Error('تطابق محتوى الملف المُنزَّل من Supabase Storage غير صحيح.');
  }

  await ctx.client.storage.from(SUPABASE_STORAGE_BUCKET).remove([probePath]);

  return {
    userId: ctx.user.id,
    email: ctx.user.email || '',
    bucket: SUPABASE_STORAGE_BUCKET,
    uploadedPath: probePath,
    verifiedBytes: downloadedBlob.size,
  };
}

// =============================================================
// SUPABASE POSTGRES CRUD & CROSS-DEVICE SYNC (WITH RLS)
// =============================================================

function mapPassageToRow(userId: string, p: GermanTextPassage) {
  return {
    user_id: userId,
    id: p.id,
    title: p.title,
    author_info: p.authorInfo || '',
    level: p.level,
    german_text: p.germanText,
    sentences: p.sentences || [],
    arabic_summary: p.arabicSummary || '',
    key_vocabulary: p.keyVocabulary || [],
    word_count: p.wordCount || 0,
    style: p.style || 'Custom Text',
    topic: p.topic || '',
    is_favorite: Boolean(p.isFavorite),
    last_read_sentence_index: p.lastReadSentenceIndex || 0,
    storage_path: p.storagePath || null,
    file_name: p.fileName || null,
    file_size: typeof p.fileSize === 'number' ? p.fileSize : null,
    mime_type: p.mimeType || null,
    created_at: p.createdAt || new Date().toISOString(),
    updated_at: p.updatedAt || new Date().toISOString(),
  };
}

function mapRowToPassage(row: any): GermanTextPassage {
  return {
    id: row.id,
    title: row.title,
    authorInfo: row.author_info || '',
    level: row.level,
    germanText: row.german_text,
    sentences: Array.isArray(row.sentences) ? row.sentences : [],
    arabicSummary: row.arabic_summary || '',
    keyVocabulary: Array.isArray(row.key_vocabulary) ? row.key_vocabulary : [],
    wordCount: row.word_count || 0,
    style: row.style || 'Custom Text',
    topic: row.topic || '',
    isFavorite: Boolean(row.is_favorite),
    lastReadSentenceIndex: row.last_read_sentence_index || 0,
    storagePath: row.storage_path || undefined,
    fileName: row.file_name || undefined,
    fileSize: typeof row.file_size === 'number' ? row.file_size : undefined,
    mimeType: row.mime_type || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWordToRow(userId: string, w: SavedWord) {
  return {
    user_id: userId,
    id: w.id,
    german_word: w.germanWord,
    article: w.article || null,
    plural: w.plural || null,
    arabic_meaning: w.arabicMeaning,
    ipa: w.ipa || null,
    arabic_pronunciation: w.arabicPronunciation || null,
    part_of_speech: w.partOfSpeech || null,
    example_german: w.exampleGerman || null,
    example_arabic: w.exampleArabic || null,
    level: w.level,
    date_saved: w.dateSaved || new Date().toISOString(),
    source_title: w.sourceTitle || null,
    mastery: w.mastery || 'learning',
    updated_at: new Date().toISOString(),
  };
}

function mapRowToWord(row: any): SavedWord {
  return {
    id: row.id,
    germanWord: row.german_word,
    article: row.article || undefined,
    plural: row.plural || undefined,
    arabicMeaning: row.arabic_meaning,
    ipa: row.ipa || undefined,
    arabicPronunciation: row.arabic_pronunciation || undefined,
    partOfSpeech: row.part_of_speech || undefined,
    exampleGerman: row.example_german || undefined,
    exampleArabic: row.example_arabic || undefined,
    level: row.level,
    dateSaved: row.date_saved,
    sourceTitle: row.source_title || undefined,
    mastery: row.mastery || 'learning',
  };
}

export async function pushPassageToSupabase(passage: GermanTextPassage): Promise<void> {
  try {
    const ctx = await getAuthedContext();
    if (!ctx) return;
    notifySync('syncing');
    const { error } = await ctx.client
      .from('saved_texts')
      .upsert(mapPassageToRow(ctx.user.id, passage), { onConflict: 'user_id,id' });
    if (error) throw error;
    notifySync('synced');
  } catch (err: any) {
    console.error('Supabase pushPassage failed:', err?.message || err);
    notifySync('error', err?.message || 'فشل مزامنة النص مع Supabase');
  }
}

export async function deletePassageFromSupabase(
  passageId: string,
  storagePath?: string
): Promise<void> {
  try {
    const ctx = await getAuthedContext();
    if (!ctx) return;
    notifySync('syncing');
    const { error } = await ctx.client
      .from('saved_texts')
      .delete()
      .eq('user_id', ctx.user.id)
      .eq('id', passageId);
    if (error) throw error;

    await ctx.client
      .from('reading_history')
      .delete()
      .eq('user_id', ctx.user.id)
      .eq('text_id', passageId);

    if (storagePath) {
      await ctx.client.storage.from(SUPABASE_STORAGE_BUCKET).remove([storagePath]);
    }
    notifySync('synced');
  } catch (err: any) {
    console.error('Supabase deletePassage failed:', err?.message || err);
    notifySync('error', err?.message || 'فشل حذف النص من Supabase');
  }
}

export async function pushWordToSupabase(word: SavedWord): Promise<void> {
  try {
    const ctx = await getAuthedContext();
    if (!ctx) return;
    notifySync('syncing');
    const { error } = await ctx.client
      .from('saved_vocabulary')
      .upsert(mapWordToRow(ctx.user.id, word), { onConflict: 'user_id,id' });
    if (error) throw error;
    notifySync('synced');
  } catch (err: any) {
    console.error('Supabase pushWord failed:', err?.message || err);
    notifySync('error', err?.message || 'فشل مزامنة المفردة مع Supabase');
  }
}

export async function pushAllWordsToSupabase(words: SavedWord[]): Promise<void> {
  try {
    const ctx = await getAuthedContext();
    if (!ctx || words.length === 0) return;
    notifySync('syncing');
    const rows = words.map((w) => mapWordToRow(ctx.user.id, w));
    const { error } = await ctx.client
      .from('saved_vocabulary')
      .upsert(rows, { onConflict: 'user_id,id' });
    if (error) throw error;
    notifySync('synced');
  } catch (err: any) {
    console.error('Supabase pushAllWords failed:', err?.message || err);
    notifySync('error', err?.message || 'فشل مزامنة المفردات مع Supabase');
  }
}

export async function pushWordsBatchToSupabase(words: SavedWord[]): Promise<{
  attempted: boolean;
  synced: boolean;
  error?: string;
}> {
  try {
    const ctx = await getAuthedContext();
    if (!ctx || words.length === 0) {
      return { attempted: false, synced: false };
    }
    notifySync('syncing');
    const rows = words.map((w) => mapWordToRow(ctx.user.id, w));
    const { error } = await ctx.client
      .from('saved_vocabulary')
      .upsert(rows, { onConflict: 'user_id,id' });
    if (error) throw error;
    notifySync('synced');
    return { attempted: true, synced: true };
  } catch (err: any) {
    const msg = err?.message || 'فشل مزامنة المفردات مع Supabase';
    console.error('Supabase pushWordsBatch failed:', msg);
    notifySync('error', msg);
    return { attempted: true, synced: false, error: msg };
  }
}

export async function deleteWordFromSupabase(wordId: string): Promise<void> {
  try {
    const ctx = await getAuthedContext();
    if (!ctx) return;
    notifySync('syncing');
    const { error } = await ctx.client
      .from('saved_vocabulary')
      .delete()
      .eq('user_id', ctx.user.id)
      .eq('id', wordId);
    if (error) throw error;
    notifySync('synced');
  } catch (err: any) {
    console.error('Supabase deleteWord failed:', err?.message || err);
    notifySync('error', err?.message || 'فشل حذف المفردة من Supabase');
  }
}

export async function pushReadingHistoryToSupabase(entry: ReadingHistoryEntry): Promise<void> {
  try {
    const ctx = await getAuthedContext();
    if (!ctx) return;
    const { error } = await ctx.client.from('reading_history').upsert(
      {
        user_id: ctx.user.id,
        text_id: entry.textId,
        title: entry.title,
        level: entry.level,
        last_sentence_index: entry.lastSentenceIndex,
        total_sentences: entry.totalSentences,
        last_read_at: entry.lastReadAt,
      },
      { onConflict: 'user_id,text_id' }
    );
    if (error) throw error;

    await ctx.client
      .from('saved_texts')
      .update({
        last_read_sentence_index: entry.lastSentenceIndex,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', ctx.user.id)
      .eq('id', entry.textId);
  } catch (err: any) {
    console.error('Supabase pushReadingHistory failed:', err?.message || err);
  }
}

export async function clearReadingHistoryInSupabase(): Promise<void> {
  try {
    const ctx = await getAuthedContext();
    if (!ctx) return;
    notifySync('syncing');
    await ctx.client.from('reading_history').delete().eq('user_id', ctx.user.id);
    notifySync('synced');
  } catch (err: any) {
    console.error('Supabase clearReadingHistory failed:', err?.message || err);
    notifySync('error', err?.message || 'فشل مسح سجل القراءة في Supabase');
  }
}

export async function pushUserSettingsToSupabase(payload: {
  settings: ReadingSettings;
  stats: ListeningStats;
  activeTextId: string;
}): Promise<void> {
  try {
    const ctx = await getAuthedContext();
    if (!ctx) return;
    const { error } = await ctx.client.from('user_settings').upsert(
      {
        user_id: ctx.user.id,
        settings: payload.settings,
        stats: payload.stats,
        active_text_id: payload.activeTextId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    if (error) throw error;
  } catch (err: any) {
    console.error('Supabase pushUserSettings failed:', err?.message || err);
  }
}

/**
 * Full bi-directional sync between IndexedDB/localStorage and Supabase when user logs in
 * or triggers manual sync, ensuring user data is available across all devices.
 */
export async function syncAllWithSupabase(local: {
  texts: GermanTextPassage[];
  words: SavedWord[];
  history: ReadingHistoryEntry[];
  settings: ReadingSettings;
  stats: ListeningStats;
  activeTextId: string;
}): Promise<{
  texts: GermanTextPassage[];
  words: SavedWord[];
  history: ReadingHistoryEntry[];
  settings: ReadingSettings;
  stats: ListeningStats;
  activeTextId: string;
} | null> {
  const ctx = await getAuthedContext();
  if (!ctx) return null;

  notifySync('syncing');

  try {
    const [textsRes, wordsRes, historyRes, settingsRes] = await Promise.all([
      ctx.client
        .from('saved_texts')
        .select('*')
        .eq('user_id', ctx.user.id)
        .order('created_at', { ascending: false }),
      ctx.client
        .from('saved_vocabulary')
        .select('*')
        .eq('user_id', ctx.user.id)
        .order('date_saved', { ascending: false }),
      ctx.client
        .from('reading_history')
        .select('*')
        .eq('user_id', ctx.user.id)
        .order('last_read_at', { ascending: false }),
      ctx.client
        .from('user_settings')
        .select('*')
        .eq('user_id', ctx.user.id)
        .maybeSingle(),
    ]);

    if (textsRes.error) throw textsRes.error;
    if (wordsRes.error) throw wordsRes.error;
    if (historyRes.error) throw historyRes.error;
    if (settingsRes.error) throw settingsRes.error;

    const remoteTexts: GermanTextPassage[] = (textsRes.data || []).map(mapRowToPassage);
    const remoteWords: SavedWord[] = (wordsRes.data || []).map(mapRowToWord);
    const remoteHistory: ReadingHistoryEntry[] = (historyRes.data || []).map((r: any) => ({
      textId: r.text_id,
      title: r.title,
      level: r.level,
      lastSentenceIndex: r.last_sentence_index || 0,
      totalSentences: r.total_sentences || 0,
      lastReadAt: r.last_read_at,
    }));

    // Merge texts (prefer newer updatedAt, preserve all cloud texts + upload local-only texts)
    const textMap = new Map<string, GermanTextPassage>();
    for (const rt of remoteTexts) textMap.set(rt.id, rt);
    const textsToPush: GermanTextPassage[] = [];
    for (const lt of local.texts) {
      const existing = textMap.get(lt.id);
      if (!existing) {
        textMap.set(lt.id, lt);
        textsToPush.push(lt);
      } else {
        const localTime = new Date(lt.updatedAt || lt.createdAt).getTime();
        const remoteTime = new Date(existing.updatedAt || existing.createdAt).getTime();
        if (localTime > remoteTime) {
          textMap.set(lt.id, lt);
          textsToPush.push(lt);
        }
      }
    }
    const mergedTexts = Array.from(textMap.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    if (textsToPush.length > 0) {
      const { error: pushTextsErr } = await ctx.client
        .from('saved_texts')
        .upsert(textsToPush.map((t) => mapPassageToRow(ctx.user.id, t)), {
          onConflict: 'user_id,id',
        });
      if (pushTextsErr) throw pushTextsErr;
    }

    // Merge vocabulary (union by id / lowercase germanWord)
    const wordMap = new Map<string, SavedWord>();
    for (const rw of remoteWords) wordMap.set(rw.germanWord.toLowerCase(), rw);
    const wordsToPush: SavedWord[] = [];
    for (const lw of local.words) {
      const key = lw.germanWord.toLowerCase();
      if (!wordMap.has(key)) {
        wordMap.set(key, lw);
        wordsToPush.push(lw);
      }
    }
    const mergedWords = Array.from(wordMap.values()).sort(
      (a, b) => new Date(b.dateSaved).getTime() - new Date(a.dateSaved).getTime()
    );
    if (wordsToPush.length > 0) {
      const { error: pushWordsErr } = await ctx.client
        .from('saved_vocabulary')
        .upsert(wordsToPush.map((w) => mapWordToRow(ctx.user.id, w)), {
          onConflict: 'user_id,id',
        });
      if (pushWordsErr) throw pushWordsErr;
    }

    // Merge reading history (keep most recent lastReadAt per textId)
    const histMap = new Map<string, ReadingHistoryEntry>();
    for (const rh of remoteHistory) histMap.set(rh.textId, rh);
    const histToPush: ReadingHistoryEntry[] = [];
    for (const lh of local.history) {
      const existing = histMap.get(lh.textId);
      if (
        !existing ||
        new Date(lh.lastReadAt).getTime() > new Date(existing.lastReadAt).getTime()
      ) {
        histMap.set(lh.textId, lh);
        histToPush.push(lh);
      }
    }
    const mergedHistory = Array.from(histMap.values()).sort(
      (a, b) => new Date(b.lastReadAt).getTime() - new Date(a.lastReadAt).getTime()
    );
    if (histToPush.length > 0) {
      const { error: pushHistoryErr } = await ctx.client.from('reading_history').upsert(
        histToPush.map((h) => ({
          user_id: ctx.user.id,
          text_id: h.textId,
          title: h.title,
          level: h.level,
          last_sentence_index: h.lastSentenceIndex,
          total_sentences: h.totalSentences,
          last_read_at: h.lastReadAt,
        })),
        { onConflict: 'user_id,text_id' }
      );
      if (pushHistoryErr) throw pushHistoryErr;
    }

    // Apply or initialize remote settings & stats
    let mergedSettings = local.settings;
    let mergedStats = local.stats;
    let mergedActiveTextId = local.activeTextId;

    if (settingsRes.data) {
      if (settingsRes.data.settings && typeof settingsRes.data.settings === 'object') {
        mergedSettings = { ...local.settings, ...settingsRes.data.settings };
      }
      if (settingsRes.data.stats && typeof settingsRes.data.stats === 'object') {
        const rs = settingsRes.data.stats as Partial<ListeningStats>;
        mergedStats = {
          totalMinutesListened: Math.max(
            local.stats.totalMinutesListened,
            rs.totalMinutesListened || 0
          ),
          sentencesRead: Math.max(local.stats.sentencesRead, rs.sentencesRead || 0),
          wordsLookedUp: Math.max(local.stats.wordsLookedUp, rs.wordsLookedUp || 0),
          textsCompleted: Math.max(local.stats.textsCompleted, rs.textsCompleted || 0),
        };
      }
      if (settingsRes.data.active_text_id) {
        mergedActiveTextId = settingsRes.data.active_text_id;
      }
    } else {
      const { error: initSettingsErr } = await ctx.client.from('user_settings').upsert(
        {
          user_id: ctx.user.id,
          settings: mergedSettings,
          stats: mergedStats,
          active_text_id: mergedActiveTextId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
      if (initSettingsErr) throw initSettingsErr;
    }

    notifySync('synced');
    return {
      texts: mergedTexts,
      words: mergedWords,
      history: mergedHistory,
      settings: mergedSettings,
      stats: mergedStats,
      activeTextId: mergedActiveTextId,
    };
  } catch (err: any) {
    console.error('Supabase full sync failed:', err?.message || err);
    notifySync('error', err?.message || 'تعذرت المزامنة مع Supabase. تحقق من تشغيل SQL Schema.');
    return null;
  }
}

/**
 * Manually uploads raw text (or an existing GermanTextPassage) to the private
 * `german-learning` Supabase Storage bucket and optionally updates `saved_texts`.
 * Throws a descriptive Arabic error on auth/storage/DB failure so the UI can show it.
 */
export async function uploadTextManuallyToSupabase(params: {
  title: string;
  content: string;
  fileName?: string;
  passage?: GermanTextPassage;
}): Promise<{
  storagePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}> {
  const ctx = await getAuthedContext();
  if (!ctx) {
    throw new Error('يرجى تسجيل الدخول بحساب Supabase أولاً لرفع الملف أو النص إلى السحابة.');
  }

  const trimmedContent = params.content.trim();
  if (!trimmedContent) {
    throw new Error('المحتوى النصي فارغ ولا يمكن رفعه إلى Supabase.');
  }

  const baseName = sanitizeStorageFileName(
    (params.fileName || params.title || 'german_text').replace(/\.txt$/i, '')
  );
  const finalFileName = baseName.endsWith('.txt') ? baseName : `${baseName}.txt`;
  const storagePath = `${ctx.user.id}/${Date.now()}_${finalFileName}`;
  const blob = new Blob([trimmedContent], { type: 'text/plain;charset=utf-8' });

  notifySync('syncing');
  try {
    const { error: uploadErr } = await ctx.client.storage
      .from(SUPABASE_STORAGE_BUCKET)
      .upload(storagePath, blob, {
        cacheControl: '3600',
        upsert: false,
        contentType: 'text/plain',
      });

    if (uploadErr) {
      throw new Error(`فشل الرفع إلى Supabase Storage: ${uploadErr.message}`);
    }

    if (params.passage) {
      const updatedPassage: GermanTextPassage = {
        ...params.passage,
        storagePath,
        fileName: finalFileName,
        fileSize: blob.size,
        mimeType: 'text/plain',
        updatedAt: new Date().toISOString(),
      };
      const { error: dbErr } = await ctx.client
        .from('saved_texts')
        .upsert(mapPassageToRow(ctx.user.id, updatedPassage), { onConflict: 'user_id,id' });
      if (dbErr) {
        throw new Error(`تم رفع الملف للحاوية لكن فشل تحديث قاعدة البيانات: ${dbErr.message}`);
      }
    }

    notifySync('synced');
    return {
      storagePath,
      fileName: finalFileName,
      fileSize: blob.size,
      mimeType: 'text/plain',
    };
  } catch (err: any) {
    const msg = err?.message || 'تعذر الرفع اليدوي إلى Supabase.';
    notifySync('error', msg);
    throw new Error(msg);
  }
}

/**
 * Manually pushes all local IndexedDB/localStorage data (texts, vocabulary, history, settings)
 * to Supabase Postgres, throwing a clear error if not signed in or if any upsert fails.
 */
export async function pushAllLocalDataManuallyToSupabase(local: {
  texts: GermanTextPassage[];
  words: SavedWord[];
  history: ReadingHistoryEntry[];
  settings: ReadingSettings;
  stats: ListeningStats;
  activeTextId: string;
}): Promise<{
  textsCount: number;
  wordsCount: number;
  historyCount: number;
}> {
  const ctx = await getAuthedContext();
  if (!ctx) {
    throw new Error('يرجى تسجيل الدخول بحساب Supabase أولاً لرفع البيانات المحلية إلى السحابة.');
  }

  notifySync('syncing');
  try {
    if (local.texts.length > 0) {
      const { error } = await ctx.client
        .from('saved_texts')
        .upsert(local.texts.map((t) => mapPassageToRow(ctx.user.id, t)), {
          onConflict: 'user_id,id',
        });
      if (error) throw new Error(`فشل رفع النصوص: ${error.message}`);
    }

    if (local.words.length > 0) {
      const { error } = await ctx.client
        .from('saved_vocabulary')
        .upsert(local.words.map((w) => mapWordToRow(ctx.user.id, w)), {
          onConflict: 'user_id,id',
        });
      if (error) throw new Error(`فشل رفع المفردات: ${error.message}`);
    }

    if (local.history.length > 0) {
      const { error } = await ctx.client.from('reading_history').upsert(
        local.history.map((h) => ({
          user_id: ctx.user.id,
          text_id: h.textId,
          title: h.title,
          level: h.level,
          last_sentence_index: h.lastSentenceIndex,
          total_sentences: h.totalSentences,
          last_read_at: h.lastReadAt,
        })),
        { onConflict: 'user_id,text_id' }
      );
      if (error) throw new Error(`فشل رفع سجل القراءة: ${error.message}`);
    }

    const { error: settingsErr } = await ctx.client.from('user_settings').upsert(
      {
        user_id: ctx.user.id,
        settings: local.settings,
        stats: local.stats,
        active_text_id: local.activeTextId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    if (settingsErr) throw new Error(`فشل رفع الإعدادات: ${settingsErr.message}`);

    notifySync('synced');
    return {
      textsCount: local.texts.length,
      wordsCount: local.words.length,
      historyCount: local.history.length,
    };
  } catch (err: any) {
    const msg = err?.message || 'تعذر رفع البيانات إلى Supabase.';
    notifySync('error', msg);
    throw new Error(msg);
  }
}

// =============================================================
// AUDIO-ONLY UPLOAD FROM LOCAL INDEXEDDB CACHE (NAMED BY TEXT)
// =============================================================

function isMimeRejectedError(message: string): boolean {
  return isBucketMimeConfigError(message);
}

/**
 * Uploads ONLY the binary audio file from a single IndexedDB cache record
 * using its true detected audio MIME type (`audio/mpeg`, `audio/wav`, etc.)
 * to `german-learning/<userId>/audio/<text>.<ext>`.
 * Skips uploading if a matching audio word/phrase already exists in Supabase Storage.
 */
export async function uploadSingleAudioCacheRecordToSupabase(
  record: IndexedDbAudioRecord,
  overrideFileName?: string,
  preloadedIndex?: Map<string, SupabaseStorageFileItem>
): Promise<{
  storagePath: string;
  fileName: string;
  size: number;
  mimeType: string;
  skippedExisting: boolean;
}> {
  const ctx = await getAuthedContext();
  if (!ctx) {
    throw new Error('يرجى تسجيل الدخول بحساب Supabase أولاً لرفع الملفات الصوتية إلى السحابة.');
  }

  if (!(record.blob instanceof Blob) || record.blob.size < 60) {
    throw new Error(`الملف الصوتي الخاص بـ «${record.text}» غير صالح أو فارغ.`);
  }

  // Skip re-uploading if this word/phrase is already stored in Supabase Storage
  const indexMap = preloadedIndex || (await getAudioIndexMap(ctx, { forceRefresh: true }));
  const existing =
    findMatchingAudioEntryInMap(indexMap, record.text) ||
    (overrideFileName ? findMatchingAudioEntryInMap(indexMap, overrideFileName) : undefined);

  if (existing) {
    return {
      storagePath: existing.path,
      fileName: existing.name,
      size: existing.size || record.blob.size,
      mimeType: existing.mimeType || record.mimeType || 'audio/mpeg',
      skippedExisting: true,
    };
  }

  const detectedMime = await detectActualMimeType(
    record.blob,
    overrideFileName || (record.mimeType?.includes('wav') ? 'audio.wav' : 'audio.mp3')
  );
  let preferredMime =
    detectedMime !== 'application/octet-stream'
      ? detectedMime
      : record.mimeType || record.blob.type || 'audio/mpeg';

  const rawFileName =
    overrideFileName || buildAudioFileNameFromText(record.text, preferredMime, record.audioHash);
  const { preservedName, asciiFallbackName } = preserveUploadFilename(rawFileName);

  const attemptUpload = async (path: string, contentType: string, upsert: boolean) => {
    const { error } = await ctx.client.storage
      .from(SUPABASE_STORAGE_BUCKET)
      .upload(path, record.blob, {
        cacheControl: '3600',
        upsert,
        contentType,
      });
    return error;
  };

  let activeFileName = preservedName;
  let storagePath = `${ctx.user.id}/audio/${activeFileName}`;
  let uploadErr = await attemptUpload(storagePath, preferredMime, true);

  if (uploadErr && isInvalidStorageKeyError(uploadErr.message) && asciiFallbackName !== preservedName) {
    activeFileName = asciiFallbackName;
    storagePath = `${ctx.user.id}/audio/${activeFileName}`;
    uploadErr = await attemptUpload(storagePath, preferredMime, true);
  }

  const altMime = getAlternateAudioMimeType(preferredMime);
  if (uploadErr && altMime && isMimeRejectedError(uploadErr.message)) {
    const altErr = await attemptUpload(storagePath, altMime, true);
    if (!altErr) {
      preferredMime = altMime;
      uploadErr = null;
    }
  }

  // Fallback if an older bucket policy allows INSERT but lacks UPDATE (needed by upsert: true)
  if (
    uploadErr &&
    (uploadErr.message.toLowerCase().includes('row-level security') ||
      uploadErr.message.toLowerCase().includes('policy'))
  ) {
    const dot = activeFileName.lastIndexOf('.');
    const base = dot > 0 ? activeFileName.slice(0, dot) : activeFileName;
    const ext = dot > 0 ? activeFileName.slice(dot) : '.mp3';
    const fallbackName = `${base}_${record.audioHash.slice(0, 6)}${ext}`;
    const fallbackPath = `${ctx.user.id}/audio/${fallbackName}`;
    const fallbackErr = await attemptUpload(fallbackPath, preferredMime, false);
    if (!fallbackErr) {
      const uploadedEntry: SupabaseStorageFileItem = {
        name: fallbackName,
        path: fallbackPath,
        size: record.blob.size,
        mimeType: preferredMime,
      };
      registerAudioEntryInMap(indexMap, uploadedEntry, record.text);
      if (!preloadedIndex) invalidateSupabaseAudioIndexCache();
      return {
        storagePath: fallbackPath,
        fileName: fallbackName,
        size: record.blob.size,
        mimeType: preferredMime,
        skippedExisting: false,
      };
    }
    uploadErr = fallbackErr;
  }

  if (uploadErr) {
    throw new Error(formatSupabaseUploadError(activeFileName, uploadErr.message, preferredMime));
  }

  const uploadedEntry: SupabaseStorageFileItem = {
    name: activeFileName,
    path: storagePath,
    size: record.blob.size,
    mimeType: preferredMime,
  };
  registerAudioEntryInMap(indexMap, uploadedEntry, record.text);
  if (!preloadedIndex) {
    invalidateSupabaseAudioIndexCache();
  }

  return {
    storagePath,
    fileName: activeFileName,
    size: record.blob.size,
    mimeType: preferredMime,
    skippedExisting: false,
  };
}

/**
 * Uploads ONLY new audio files from browser IndexedDB to Supabase Storage,
 * automatically skipping any word/phrase that already exists in `<userId>/audio/`
 * so duplicate files are never uploaded again.
 */
export async function uploadAllAudioCacheFilesToSupabase(
  records: IndexedDbAudioRecord[],
  onProgress?: (progress: { completed: number; total: number; currentFileName: string }) => void
): Promise<{
  total: number;
  uploadedCount: number;
  skippedCount: number;
  failedCount: number;
  uploadedFiles: string[];
  skippedFiles: string[];
  errors: string[];
}> {
  const ctx = await getAuthedContext();
  if (!ctx) {
    throw new Error('يرجى تسجيل الدخول بحساب Supabase أولاً لرفع الملفات الصوتية إلى السحابة.');
  }

  if (!records || records.length === 0) {
    throw new Error('لا توجد ملفات صوتية محفوظة في الكاش المحلي (IndexedDB).');
  }

  const indexMap = await getAudioIndexMap(ctx, { forceRefresh: true });
  const usedNames = new Set<string>();
  const uploadedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const baseFileName = buildAudioFileNameFromText(
      record.text,
      record.mimeType || record.blob.type || 'audio/mpeg',
      record.audioHash
    );
    const uniqueFileName = dedupeAudioFileName(baseFileName, usedNames);

    onProgress?.({
      completed: i,
      total: records.length,
      currentFileName: uniqueFileName,
    });

    try {
      const res = await uploadSingleAudioCacheRecordToSupabase(record, uniqueFileName, indexMap);
      if (res.skippedExisting) {
        skippedFiles.push(res.fileName);
      } else {
        uploadedFiles.push(res.fileName);
      }
    } catch (err: any) {
      errors.push(`${uniqueFileName}: ${err?.message || 'خطأ غير معروف'}`);
    }
  }

  invalidateSupabaseAudioIndexCache();

  onProgress?.({
    completed: records.length,
    total: records.length,
    currentFileName: '',
  });

  return {
    total: records.length,
    uploadedCount: uploadedFiles.length,
    skippedCount: skippedFiles.length,
    failedCount: errors.length,
    uploadedFiles,
    skippedFiles,
    errors,
  };
}

// =============================================================
// AUDIO LOOKUP & DEDUPLICATION IN SUPABASE STORAGE
// =============================================================

const AUDIO_INDEX_TTL_MS = 60_000;
let cachedAudioIndex: {
  userId: string;
  fetchedAt: number;
  byStem: Map<string, SupabaseStorageFileItem>;
} | null = null;
let inFlightAudioIndexFetch: Promise<Map<string, SupabaseStorageFileItem>> | null = null;
const dedupedUsersThisSession = new Set<string>();
let inFlightDedupePromise: Promise<SupabaseAudioDedupeResult> | null = null;

export function invalidateSupabaseAudioIndexCache(): void {
  cachedAudioIndex = null;
}

/**
 * Generates normalized lookup keys (exact lowercased + transliterated German ASCII)
 * for matching a spoken word/phrase against files inside `<userId>/audio/`.
 */
export function buildAudioLookupStems(textOrFileName: string): string[] {
  const cleaned = (textOrFileName || '')
    .normalize('NFC')
    .trim()
    .replace(/\.(mp3|wav|m4a|ogg|webm|aac|flac)$/i, '')
    .replace(/^[.,!?;:„"“»«()\s]+|[.,!?;:„"“»«()\s]+$/g, '');

  if (!cleaned) return [];

  const exactStem = cleaned
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[/\\?%*:|"<>#]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  const transliterated = cleaned
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');

  const stems: string[] = [];
  if (exactStem) stems.push(exactStem);
  if (transliterated && transliterated !== exactStem) stems.push(transliterated);
  return stems;
}

function getCanonicalGroupKeyFromStem(stemText: string): string {
  const stems = buildAudioLookupStems(stemText);
  return stems[stems.length - 1] || stems[0] || '';
}

function registerAudioEntryInMap(
  byStem: Map<string, SupabaseStorageFileItem>,
  entry: SupabaseStorageFileItem,
  extraText?: string
): void {
  const stems = new Set<string>([
    ...buildAudioLookupStems(entry.name),
    ...(extraText ? buildAudioLookupStems(extraText) : []),
  ]);
  for (const stem of stems) {
    const existing = byStem.get(stem);
    if (
      !existing ||
      (entry.name.toLowerCase().endsWith('.mp3') && !existing.name.toLowerCase().endsWith('.mp3'))
    ) {
      byStem.set(stem, entry);
    }
  }
}

function findMatchingAudioEntryInMap(
  byStem: Map<string, SupabaseStorageFileItem>,
  textOrFileName: string
): SupabaseStorageFileItem | undefined {
  const stems = buildAudioLookupStems(textOrFileName);
  for (const stem of stems) {
    const hit = byStem.get(stem);
    if (hit) return hit;
  }

  // Also match stripped duplicate-suffix base (e.g. uploading "sehr (1).mp3" when "sehr.mp3" exists)
  const rawBase = (textOrFileName || '')
    .normalize('NFC')
    .trim()
    .replace(/\.(mp3|wav|m4a|ogg|webm|aac|flac)$/i, '');
  const stripped = stripDuplicateSuffixes(rawBase);
  if (stripped && stripped.base !== rawBase) {
    for (const stem of buildAudioLookupStems(stripped.base)) {
      const hit = byStem.get(stem);
      if (hit) return hit;
    }
  }
  return undefined;
}

function stripDuplicateSuffixes(rawBase: string): {
  base: string;
  hasExplicitDupMarker: boolean;
  numericSuffixBase: string | null;
} {
  let base = rawBase.trim();
  let hasExplicitDupMarker = false;

  // 1. OS duplicate suffix like "sehr (1)" or "sehr (2)"
  const parenMatch = base.match(/^(.+?)\s*\(\d+\)$/);
  if (parenMatch && parenMatch[1].trim()) {
    base = parenMatch[1].trim();
    hasExplicitDupMarker = true;
  }

  // 2. Leading timestamp prefix like "1731567890123_sehr"
  const leadTsMatch = base.match(/^\d{10,14}_(.+)$/);
  if (leadTsMatch && leadTsMatch[1].trim()) {
    base = leadTsMatch[1].trim();
    hasExplicitDupMarker = true;
  }

  // 3. Trailing timestamp suffix like "sehr_1731567890123"
  const trailTsMatch = base.match(/^(.+?)_\d{10,14}$/);
  if (trailTsMatch && trailTsMatch[1].trim()) {
    base = trailTsMatch[1].trim();
    hasExplicitDupMarker = true;
  }

  // 4. Trailing 6-8 char hex hash containing digits like "sehr_a3f91c"
  const hexMatch = base.match(/^(.+?)_(?=[0-9a-f]*\d)[0-9a-f]{6,8}$/i);
  if (hexMatch && hexMatch[1].trim()) {
    base = hexMatch[1].trim();
    hasExplicitDupMarker = true;
  }

  // 5. Trailing short counter like "sehr_2" (only merged if clean base also exists in bucket)
  let numericSuffixBase: string | null = null;
  const numMatch = base.match(/^(.+?)_(\d{1,3})$/);
  if (numMatch && numMatch[1].trim()) {
    numericSuffixBase = numMatch[1].trim();
  }

  return { base, hasExplicitDupMarker, numericSuffixBase };
}

function scoreAudioFileToKeep(item: SupabaseStorageFileItem, hasDupSuffix: boolean): number {
  const leafName = item.name.replace(/^audio\//, '');
  const lower = leafName.toLowerCase();
  let score = 0;

  if ((item.size || 0) > 0) score += 100_000;
  if (!hasDupSuffix) score += 10_000;

  if (lower.endsWith('.mp3')) score += 1_000;
  else if (lower.endsWith('.wav')) score += 500;
  else if (lower.endsWith('.m4a')) score += 300;
  else score += 100;

  // Prefer original German umlauts/ß and shorter clean names over transliterated copies
  if (/[äöüß]/i.test(leafName)) score += 50;
  score += Math.max(0, 120 - leafName.length);

  return score;
}

export interface SupabaseAudioDuplicatePlan {
  groupsWithDuplicates: number;
  kept: SupabaseStorageFileItem[];
  toDelete: SupabaseStorageFileItem[];
}

/**
 * Pure planner that identifies duplicate audio files for the same German word/phrase
 * (different extensions, casing, umlaut/ASCII transliteration, or `_2`/`_hash`/`(1)` copies)
 * and keeps strictly ONE best file per word.
 */
export function planAudioDuplicatesCleanup(
  items: SupabaseStorageFileItem[]
): SupabaseAudioDuplicatePlan {
  const parsed = items.map((item) => {
    const leafName = item.name.replace(/^audio\//, '');
    const rawBase = leafName.replace(/\.(mp3|wav|m4a|ogg|webm|aac|flac)$/i, '').normalize('NFC').trim();
    const { base, hasExplicitDupMarker, numericSuffixBase } = stripDuplicateSuffixes(rawBase);
    const canonicalBaseKey = getCanonicalGroupKeyFromStem(base);
    const numericGroupKey = numericSuffixBase ? getCanonicalGroupKeyFromStem(numericSuffixBase) : null;
    return {
      item,
      hasExplicitDupMarker,
      canonicalBaseKey,
      numericGroupKey,
    };
  });

  // Collect clean base keys so `sehr_2.mp3` only merges with `sehr.mp3` when `sehr` exists
  // (preventing false merges of e.g. `Lektion_1.mp3` and `Lektion_2.mp3`).
  const existingBaseKeys = new Set<string>();
  for (const entry of parsed) {
    if (entry.canonicalBaseKey && !entry.numericGroupKey) {
      existingBaseKeys.add(entry.canonicalBaseKey);
    }
  }

  const groups = new Map<
    string,
    Array<{ item: SupabaseStorageFileItem; hasDupSuffix: boolean }>
  >();

  for (const entry of parsed) {
    let groupKey = entry.canonicalBaseKey;
    let hasDupSuffix = entry.hasExplicitDupMarker;

    if (entry.numericGroupKey && existingBaseKeys.has(entry.numericGroupKey)) {
      groupKey = entry.numericGroupKey;
      hasDupSuffix = true;
    }

    if (!groupKey) {
      groupKey = entry.item.path;
    }

    const list = groups.get(groupKey) || [];
    list.push({ item: entry.item, hasDupSuffix });
    groups.set(groupKey, list);
  }

  const kept: SupabaseStorageFileItem[] = [];
  const toDelete: SupabaseStorageFileItem[] = [];
  let groupsWithDuplicates = 0;

  for (const [, group] of groups) {
    if (group.length <= 1) {
      if (group[0]) kept.push(group[0].item);
      continue;
    }

    groupsWithDuplicates += 1;
    const sorted = [...group].sort((a, b) => {
      const diff =
        scoreAudioFileToKeep(b.item, b.hasDupSuffix) -
        scoreAudioFileToKeep(a.item, a.hasDupSuffix);
      if (diff !== 0) return diff;
      const ta = a.item.createdAt ? new Date(a.item.createdAt).getTime() : 0;
      const tb = b.item.createdAt ? new Date(b.item.createdAt).getTime() : 0;
      return tb - ta;
    });

    kept.push(sorted[0].item);
    for (let i = 1; i < sorted.length; i++) {
      toDelete.push(sorted[i].item);
    }
  }

  return {
    groupsWithDuplicates,
    kept,
    toDelete,
  };
}

export interface SupabaseAudioDedupeResult {
  totalScanned: number;
  groupsWithDuplicates: number;
  deletedCount: number;
  keptCount: number;
  deletedFiles: string[];
}

/**
 * Scans `german-learning/<userId>/audio/` in Supabase Storage, deletes all duplicate
 * word/phrase audio files, and keeps strictly ONE copy per word.
 */
export async function deduplicateSupabaseAudioStorage(): Promise<SupabaseAudioDedupeResult> {
  const ctx = await getAuthedContext();
  if (!ctx) {
    throw new Error('يرجى تسجيل الدخول بحساب Supabase أولاً لفحص وحذف الكلمات الصوتية المكررة.');
  }

  const audioItems = await listAllAudioItemsFromBucket(ctx);
  const plan = planAudioDuplicatesCleanup(audioItems);

  if (plan.toDelete.length === 0) {
    dedupedUsersThisSession.add(ctx.user.id);
    return {
      totalScanned: audioItems.length,
      groupsWithDuplicates: 0,
      deletedCount: 0,
      keptCount: plan.kept.length,
      deletedFiles: [],
    };
  }

  const pathsToRemove = plan.toDelete.map((item) => item.path);
  const deletedFiles: string[] = [];

  for (let i = 0; i < pathsToRemove.length; i += 100) {
    const chunk = pathsToRemove.slice(i, i + 100);
    const { error } = await ctx.client.storage.from(SUPABASE_STORAGE_BUCKET).remove(chunk);
    if (error) {
      throw new Error(`تعذر حذف الملفات المكررة من Supabase Storage: ${error.message}`);
    }
    for (let j = 0; j < chunk.length; j++) {
      const deletedItem = plan.toDelete[i + j];
      if (deletedItem) deletedFiles.push(deletedItem.name);
    }
  }

  invalidateSupabaseAudioIndexCache();
  dedupedUsersThisSession.add(ctx.user.id);

  return {
    totalScanned: audioItems.length,
    groupsWithDuplicates: plan.groupsWithDuplicates,
    deletedCount: deletedFiles.length,
    keptCount: plan.kept.length,
    deletedFiles,
  };
}

/**
 * Runs duplicate cleanup at most once per signed-in user session without throwing,
 * so stale duplicates already stored in Supabase are cleaned up automatically.
 */
export async function ensureSupabaseAudioDeduplicatedOnce(): Promise<SupabaseAudioDedupeResult | null> {
  try {
    const ctx = await getAuthedContext();
    if (!ctx) return null;
    if (dedupedUsersThisSession.has(ctx.user.id)) return null;
    if (inFlightDedupePromise) return await inFlightDedupePromise;

    inFlightDedupePromise = deduplicateSupabaseAudioStorage().finally(() => {
      inFlightDedupePromise = null;
    });
    return await inFlightDedupePromise;
  } catch (err) {
    console.warn('[SupabaseAudioDedupe] Skipped auto cleanup:', err);
    return null;
  }
}

async function getAudioIndexMap(
  ctx: NonNullable<Awaited<ReturnType<typeof getAuthedContext>>>,
  options?: { forceRefresh?: boolean }
): Promise<Map<string, SupabaseStorageFileItem>> {
  const now = Date.now();
  if (
    !options?.forceRefresh &&
    cachedAudioIndex &&
    cachedAudioIndex.userId === ctx.user.id &&
    now - cachedAudioIndex.fetchedAt < AUDIO_INDEX_TTL_MS
  ) {
    return cachedAudioIndex.byStem;
  }

  if (inFlightAudioIndexFetch && !options?.forceRefresh) {
    return inFlightAudioIndexFetch;
  }

  const fetchPromise = (async () => {
    const byStem = new Map<string, SupabaseStorageFileItem>();
    const items = await listAllAudioItemsFromBucket(ctx);
    for (const entry of items) {
      registerAudioEntryInMap(byStem, entry);
    }

    cachedAudioIndex = {
      userId: ctx.user.id,
      fetchedAt: Date.now(),
      byStem,
    };
    return byStem;
  })().finally(() => {
    if (inFlightAudioIndexFetch === fetchPromise) {
      inFlightAudioIndexFetch = null;
    }
  });

  inFlightAudioIndexFetch = fetchPromise;
  return fetchPromise;
}

/**
 * Checks if audio for `text` (word or sentence) already exists in Supabase Storage
 * (`german-learning/<userId>/audio/`). If found, downloads and returns a playable Blob
 * without calling ElevenLabs. Returns null when not signed in or not found.
 */
export async function findAudioInSupabaseStorageByText(text: string): Promise<{
  blob: Blob;
  mimeType: string;
  fileName: string;
  storagePath: string;
} | null> {
  try {
    const ctx = await getAuthedContext();
    if (!ctx) return null;

    const byStem = await getAudioIndexMap(ctx);
    const matched = findMatchingAudioEntryInMap(byStem, text);
    if (!matched) return null;

    const { blob, mimeType } = await fetchPlayableAudioFromSupabaseStorage(
      matched.path,
      matched.name,
      matched.mimeType
    );

    if (!blob || blob.size < 64) return null;

    return {
      blob,
      mimeType,
      fileName: matched.name,
      storagePath: matched.path,
    };
  } catch (err) {
    console.warn('[SupabaseAudioLookup] Fallback to ElevenLabs after lookup error:', err);
    return null;
  }
}


