/**
 * Icon store: fetches zip bundles, extracts icons on demand (lazy), caches blob URLs.
 * Reduces hundreds of individual icon requests to one request per category.
 */

import JSZip from 'jszip';

const DB_NAME = 'wowcraft-icons';
const DB_VERSION = 2;
const STORE_ICONS = 'icons';
const STORE_ZIPS = 'zips';

const ZIP_CATEGORIES = ['materials', 'alchemy', 'blacksmithing', 'enchanting', 'engineering', 'jewelcrafting', 'leatherworking', 'tailoring'];

// In-memory cache of blob URLs
const blobUrlCache = new Map<string, string>();

// Parsed zip objects kept in memory (lazy extraction)
const zipCache = new Map<string, JSZip>();

// Pending load promises per category (dedupe concurrent loads)
const loadPromises = new Map<string, Promise<JSZip>>();

function openDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined') return Promise.reject(new Error('IndexedDB only in browser'));
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_ICONS)) {
        db.createObjectStore(STORE_ICONS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_ZIPS)) {
        db.createObjectStore(STORE_ZIPS, { keyPath: 'key' });
      }
    };
  });
}

async function getZipBlobFromDB(category: string): Promise<Blob | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ZIPS, 'readonly');
    const req = tx.objectStore(STORE_ZIPS).get(category);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      db.close();
      resolve(req.result?.blob);
    };
  });
}

async function putZipBlobInDB(category: string, blob: Blob): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ZIPS, 'readwrite');
    tx.objectStore(STORE_ZIPS).put({ key: category, blob });
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function loadZip(category: string): Promise<JSZip> {
  const existing = zipCache.get(category);
  if (existing) return existing;

  const pending = loadPromises.get(category);
  if (pending) return pending;

  const load = async (): Promise<JSZip> => {
    try {
      // Try IndexedDB cache first (no network on repeat visits)
      const cachedBlob = await getZipBlobFromDB(category);
      let blob: Blob;
      if (cachedBlob) {
        blob = cachedBlob;
      } else {
        const res = await fetch(`/icons/${category}.zip`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        blob = await res.blob();
        await putZipBlobInDB(category, blob);
      }
      const zip = await JSZip.loadAsync(blob);
      zipCache.set(category, zip);
      return zip;
    } finally {
      loadPromises.delete(category);
    }
  };

  const promise = load();
  loadPromises.set(category, promise);
  return promise;
}

/** Get icon URL for a category and id. Extracts on demand from zip (lazy). */
export async function getIconUrl(category: string, id: number | string): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const cat = category.toLowerCase();
  if (!ZIP_CATEGORIES.includes(cat)) return null;

  const key = `${cat}/${id}`;
  const cached = blobUrlCache.get(key);
  if (cached) return cached;

  try {
    const zip = await loadZip(cat);
    const filename = `${id}.jpg`;
    const file = zip.file(filename);
    if (!file) return null;

    const blob = await file.async('blob');
    const url = URL.createObjectURL(blob);
    blobUrlCache.set(key, url);
    return url;
  } catch {
    return `/icons/${cat}/${id}.jpg`;
  }
}

/** Fallback URL for when zip is unavailable (e.g. SSR or load failure) */
export function getIconFallbackUrl(category: string, id: number | string): string {
  return `/icons/${category.toLowerCase()}/${id}.jpg`;
}

/** Preload zip bundles in the background. Call on page mount to reduce icon display delay. */
export function preloadIconZips(categories: string[]): void {
  if (typeof window === 'undefined') return;
  for (const cat of categories) {
    const c = cat.toLowerCase();
    if (ZIP_CATEGORIES.includes(c)) {
      loadZip(c).catch(() => {});
    }
  }
}
