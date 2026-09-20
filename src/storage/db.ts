import type { StoredChunk } from '../types/chunk';
import type { StoredIncident, IncidentSummary } from '../types/incident';

export interface StoredSession {
  id: string;
  tabId: string;
  startedAt: number;
  lastActiveAt: number;
}

export const DB_NAME = 'backtrack_db';
export const DB_VERSION = 1;

export const STORE_SESSIONS = 'sessions';
export const STORE_CHUNKS = 'chunks';
export const STORE_INCIDENTS = 'incidents';

export class FlightRecorderDB {
  private db: IDBDatabase | null = null;
  private idbFactory: IDBFactory;
  private dbName: string;

  constructor(customFactory?: IDBFactory, customDbName?: string) {
    this.idbFactory =
      customFactory ||
      (typeof indexedDB !== 'undefined' ? indexedDB : (undefined as unknown as IDBFactory));
    this.dbName = customDbName || DB_NAME;
  }

  public async open(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    if (!this.idbFactory) {
      throw new Error('IndexedDB não está disponível neste ambiente.');
    }

    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.idbFactory.open(this.dbName, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Store: sessions
        if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
          const sessionStore = db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
          sessionStore.createIndex('startedAt', 'startedAt', { unique: false });
        }

        // Store: chunks
        if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
          const chunkStore = db.createObjectStore(STORE_CHUNKS, { keyPath: 'id' });
          chunkStore.createIndex('sessionId', 'sessionId', { unique: false });
          chunkStore.createIndex('tabId', 'tabId', { unique: false });
          chunkStore.createIndex('sequence', 'sequence', { unique: false });
          chunkStore.createIndex('startedAt', 'startedAt', { unique: false });
          chunkStore.createIndex('endedAt', 'endedAt', { unique: false });
        }

        // Store: incidents
        if (!db.objectStoreNames.contains(STORE_INCIDENTS)) {
          const incidentStore = db.createObjectStore(STORE_INCIDENTS, { keyPath: 'id' });
          incidentStore.createIndex('sessionId', 'sessionId', { unique: false });
          incidentStore.createIndex('state', 'state', { unique: false });
          incidentStore.createIndex('triggeredAt', 'triggeredAt', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject((event.target as IDBOpenDBRequest).error);
      };
    });
  }

  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // --- SESSIONS ---

  public async putSession(session: StoredSession): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, 'readwrite');
      tx.objectStore(STORE_SESSIONS).put(session);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async getSession(id: string): Promise<StoredSession | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, 'readonly');
      const req = tx.objectStore(STORE_SESSIONS).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  // --- CHUNKS ---

  public async putChunk(chunk: StoredChunk): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readwrite');
      tx.objectStore(STORE_CHUNKS).put(chunk);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async putChunks(chunks: StoredChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readwrite');
      const store = tx.objectStore(STORE_CHUNKS);
      for (const chunk of chunks) {
        store.put(chunk);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async getChunk(id: string): Promise<StoredChunk | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readonly');
      const req = tx.objectStore(STORE_CHUNKS).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  public async getChunksByIds(ids: string[]): Promise<StoredChunk[]> {
    if (ids.length === 0) return [];
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readonly');
      const store = tx.objectStore(STORE_CHUNKS);
      const results: StoredChunk[] = [];
      let pending = ids.length;

      for (const id of ids) {
        const req = store.get(id);
        req.onsuccess = () => {
          if (req.result) results.push(req.result);
          pending--;
          if (pending === 0) resolve(results);
        };
        req.onerror = () => reject(req.error);
      }
    });
  }

  public async getChunksBySession(sessionId: string): Promise<StoredChunk[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readonly');
      const index = tx.objectStore(STORE_CHUNKS).index('sessionId');
      const req = index.getAll(sessionId);
      req.onsuccess = () => {
        const chunks = (req.result || []) as StoredChunk[];
        chunks.sort((a, b) => a.sequence - b.sequence);
        resolve(chunks);
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async getAllChunks(): Promise<StoredChunk[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readonly');
      const req = tx.objectStore(STORE_CHUNKS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  public async deleteChunks(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readwrite');
      const store = tx.objectStore(STORE_CHUNKS);
      for (const id of ids) {
        store.delete(id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- INCIDENTS ---

  public async putIncident(incident: StoredIncident): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_INCIDENTS, 'readwrite');
      tx.objectStore(STORE_INCIDENTS).put(incident);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async getIncident(id: string): Promise<StoredIncident | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_INCIDENTS, 'readonly');
      const req = tx.objectStore(STORE_INCIDENTS).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  public async getPendingIncidentForSession(sessionId: string): Promise<StoredIncident | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_INCIDENTS, 'readonly');
      const index = tx.objectStore(STORE_INCIDENTS).index('sessionId');
      const req = index.getAll(sessionId);
      req.onsuccess = () => {
        const incidents = (req.result || []) as StoredIncident[];
        const pending = incidents.find((inc) => inc.state === 'pending');
        resolve(pending || null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async listIncidents(): Promise<IncidentSummary[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_INCIDENTS, 'readonly');
      const req = tx.objectStore(STORE_INCIDENTS).getAll();
      req.onsuccess = () => {
        const incidents = (req.result || []) as StoredIncident[];
        const summaries: IncidentSummary[] = incidents.map((inc) => ({
          id: inc.id,
          reason: inc.reason,
          startedAt: inc.startedAt,
          triggeredAt: inc.triggeredAt,
          finalizedAt: inc.finalizedAt,
          eventCount: inc.chunkIds.length,
          triggerCount: inc.triggers.length
        }));
        summaries.sort((a, b) => b.triggeredAt - a.triggeredAt);
        resolve(summaries);
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async deleteIncident(id: string): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_INCIDENTS, 'readwrite');
      tx.objectStore(STORE_INCIDENTS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async getAllIncidents(): Promise<StoredIncident[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_INCIDENTS, 'readonly');
      const req = tx.objectStore(STORE_INCIDENTS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  // --- STATS & PURGE ---

  public async estimateStorageBytes(): Promise<number> {
    const chunks = await this.getAllChunks();
    return chunks.reduce((total, c) => total + (c.sizeBytes || 0), 0);
  }

  public async clearAll(): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_SESSIONS, STORE_CHUNKS, STORE_INCIDENTS], 'readwrite');
      tx.objectStore(STORE_SESSIONS).clear();
      tx.objectStore(STORE_CHUNKS).clear();
      tx.objectStore(STORE_INCIDENTS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
