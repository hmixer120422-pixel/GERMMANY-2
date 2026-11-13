import { VoiceGender } from '../types';

const DB_NAME = 'DeutschMeisterAudioCache';
const DB_VERSION = 1;
const STORE_NAME = 'audioBlobs';
const MAX_LOCAL_CACHE_BYTES = 150 * 1024 * 1024; // 150 MB soft cap with LRU eviction

export interface IndexedDbAudioRecord {
  audioHash: string;
  blob: Blob;
  size: number;
  mimeType: string;
  text: string;
  voiceId: string;
  voiceGender?: VoiceGender;
  model: string;
  sourceType: 'ElevenLabs Audio' | 'Local Only Audio';
  createdAt: number;
  lastAccessedAt: number;
}

class IndexedDbAudioCache {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private isSupported(): boolean {
    return typeof window !== 'undefined' && 'indexedDB' in window;
  }

  private openDb(): Promise<IDBDatabase> {
    if (!this.isSupported()) {
      return Promise.reject(new Error('IndexedDB is not supported in this browser.'));
    }
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'audioHash' });
          store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error || new Error('Failed to open IndexedDB audio cache.'));
      };
    });

    return this.dbPromise;
  }

  public async getAudio(audioHash: string): Promise<IndexedDbAudioRecord | null> {
    if (!this.isSupported()) return null;
    try {
      const db = await this.openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(audioHash);

        req.onsuccess = () => {
          const record = req.result as IndexedDbAudioRecord | undefined;
          if (!record || !(record.blob instanceof Blob) || record.blob.size < 128) {
            resolve(null);
            return;
          }
          // Touch lastAccessedAt for LRU
          record.lastAccessedAt = Date.now();
          try {
            store.put(record);
          } catch {
            // ignore touch error
          }
          resolve(record);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('IndexedDB getAudio failed:', err);
      return null;
    }
  }

  public async putAudio(
    record: Omit<IndexedDbAudioRecord, 'createdAt' | 'lastAccessedAt' | 'size'>
  ): Promise<boolean> {
    if (!this.isSupported()) return false;
    if (!(record.blob instanceof Blob) || record.blob.size < 128) {
      return false;
    }

    const now = Date.now();
    const fullRecord: IndexedDbAudioRecord = {
      ...record,
      size: record.blob.size,
      createdAt: now,
      lastAccessedAt: now,
    };

    try {
      // Enforce soft cap before insert
      const stats = await this.getStats();
      if (stats.totalBytes + fullRecord.size > MAX_LOCAL_CACHE_BYTES) {
        await this.evictOldest(Math.max(fullRecord.size * 2, 5 * 1024 * 1024));
      }

      await this.writeRecord(fullRecord);
      return true;
    } catch (err: any) {
      // Handle browser QuotaExceededError via LRU eviction & retry once
      if (
        err?.name === 'QuotaExceededError' ||
        String(err?.message || '').toLowerCase().includes('quota')
      ) {
        try {
          await this.evictOldest(Math.max(fullRecord.size * 3, 10 * 1024 * 1024));
          await this.writeRecord(fullRecord);
          return true;
        } catch {
          return false;
        }
      }
      console.warn('IndexedDB putAudio failed:', err);
      return false;
    }
  }

  private async writeRecord(record: IndexedDbAudioRecord): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  private async evictOldest(bytesToFree: number): Promise<void> {
    const entries = await this.listEntries();
    entries.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

    let freed = 0;
    for (const entry of entries) {
      if (freed >= bytesToFree) break;
      await this.deleteAudio(entry.audioHash);
      freed += entry.size || 0;
    }
  }

  public async deleteAudio(audioHash: string): Promise<void> {
    if (!this.isSupported()) return;
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(audioHash);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async clearAll(): Promise<void> {
    if (!this.isSupported()) return;
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async listEntries(): Promise<Omit<IndexedDbAudioRecord, 'blob'>[]> {
    if (!this.isSupported()) return [];
    try {
      const db = await this.openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const all = (req.result as IndexedDbAudioRecord[]) || [];
          resolve(
            all
              .map(({ blob: _blob, ...meta }) => meta)
              .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
          );
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  }

  public async getStats(): Promise<{ count: number; totalBytes: number }> {
    const entries = await this.listEntries();
    const totalBytes = entries.reduce((sum, item) => sum + (item.size || 0), 0);
    return { count: entries.length, totalBytes };
  }
}

export const indexedDbCache = new IndexedDbAudioCache();
