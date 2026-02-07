import { openDB } from 'idb';

const DB_NAME = 'gold-road-db';
const DB_VERSION = 1;

export const initDB = async () => {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Stores for cached data
      if (!db.objectStoreNames.contains('shipments')) {
        db.createObjectStore('shipments', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('orders')) {
        db.createObjectStore('orders', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('analytics')) {
        db.createObjectStore('analytics'); // Key-value store
      }
      
      // Store for pending sync requests
      if (!db.objectStoreNames.contains('syncQueue')) {
        db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
      }
    },
  });
};

// Sync Queue Operations
export const addToSyncQueue = async (request) => {
  const db = await initDB();
  return db.add('syncQueue', {
    url: request.url,
    method: request.method,
    data: request.data,
    params: request.params,
    headers: request.headers,
    timestamp: Date.now(),
  });
};

export const getSyncQueue = async () => {
  const db = await initDB();
  return db.getAll('syncQueue');
};

export const removeSyncQueueItem = async (id) => {
  const db = await initDB();
  return db.delete('syncQueue', id);
};

export const getSyncQueueCount = async () => {
  const db = await initDB();
  return db.count('syncQueue');
};

// Data Caching Operations (for application-level caching if needed)
export const cacheData = async (storeName, data) => {
  const db = await initDB();
  const tx = db.transaction(storeName, 'readwrite');
  if (Array.isArray(data)) {
    await Promise.all(data.map(item => tx.store.put(item)));
  } else {
    await tx.store.put(data);
  }
  await tx.done;
};

export const getCachedData = async (storeName) => {
  const db = await initDB();
  return db.getAll(storeName);
};
