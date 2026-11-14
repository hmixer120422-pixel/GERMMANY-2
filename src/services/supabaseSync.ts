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
  const dot = fileName.lastIndexOf('.');
  const rawBase = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext =
    dot > 0 ? fileName.slice(dot).normalize('NFKD').replace(/[^\w.]+/g, '').slice(0, 10) : '';
  const base =
    rawBase
      .normalize('NFKD')
      .replace(/[^\w\-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 100) || 'document';
  return `${base}${ext}`;
}

// =============================================================
// SUPABASE STORAGE API (`german-learning` private bucket)
// =============================================================

export async function uploadFileToSupabaseStorage(file: File): Promise<{
  storagePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
} | null> {
  const ctx = await getAuthedContext();
  if (!ctx) return null;

  const cleanName = sanitizeStorageFileName(file.name || 'document.txt');
  const storagePath = `${ctx.user.id}/${Date.now()}_${cleanName}`;
  const mimeType = file.type || 'application/octet-stream';

  const { error } = await ctx.client.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: mimeType,
    });

  if (error) {
    throw new Error(`فشل رفع الملف إلى Supabase Storage: ${error.message}`);
  }

  return {
    storagePath,
    fileName: file.name,
    fileSize: file.size,
    mimeType,
  };
}

export async function listUserFilesFromSupabaseStorage(): Promise<SupabaseStorageFileItem[]> {
  const ctx = await getAuthedContext();
  if (!ctx) return [];

  const { data, error } = await ctx.client.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .list(ctx.user.id, {
      limit: 100,
      offset: 0,
      sortBy: { column: 'created_at', order: 'desc' },
    });

  if (error) {
    throw new Error(`تعذر جلب قائمة الملفات من Supabase Storage: ${error.message}`);
  }

  return (data || [])
    .filter((item) => item.name && item.name !== '.emptyFolderPlaceholder')
    .map((item) => ({
      name: item.name,
      path: `${ctx.user.id}/${item.name}`,
      id: item.id || undefined,
      size: Number((item.metadata as any)?.size || 0),
      mimeType: (item.metadata as any)?.mimetype || undefined,
      createdAt: item.created_at || undefined,
      updatedAt: item.updated_at || undefined,
    }));
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

export async function deleteFileFromSupabaseStorage(storagePath: string): Promise<void> {
  const ctx = await getAuthedContext();
  if (!ctx || !storagePath) return;

  const { error } = await ctx.client.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .remove([storagePath]);

  if (error) {
    throw new Error(`تعذر حذف الملف من Supabase Storage: ${error.message}`);
  }
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
