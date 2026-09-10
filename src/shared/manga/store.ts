import type { MangaJob, MangaResult } from "./types.ts";
let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open("astra_manga_v1", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("jobs", { keyPath: "id" });
        request.result.createObjectStore("results", { keyPath: "key" });
      };
      request.onerror = () => {
        database = undefined;
        reject(request.error);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          database = undefined;
        };
        resolve(db);
      };
    });
  return database;
}
export async function saveMangaJob(job: MangaJob): Promise<void> {
  const db = await open();
  const snapshot = structuredClone(job);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("jobs", "readwrite"),
      store = tx.objectStore("jobs");
    const get = store.get(job.id);
    get.onsuccess = () => {
      if (!get.result || get.result.revision <= snapshot.revision)
        store.put(snapshot);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error("MANGA_STORAGE_FAILED"));
  });
}
export async function loadMangaJob(id: string): Promise<MangaJob | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction("jobs").objectStore("jobs").get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function getMangaCache(
  key: string,
): Promise<MangaResult | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("results", "readwrite"),
      store = tx.objectStore("results"),
      req = store.get(key);
    let value: MangaResult | undefined;
    req.onsuccess = () => {
      if (req.result && req.result.expires > Date.now()) {
        value = req.result.value;
        store.put({ ...req.result, touched: Date.now() });
      } else if (req.result) store.delete(key);
    };
    tx.oncomplete = () => resolve(value);
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}
export async function putMangaCache(
  key: string,
  value: MangaResult,
): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("results", "readwrite"),
      store = tx.objectStore("results"),
      req = store.getAll();
    req.onsuccess = () => {
      const rows = req.result
        .filter((row) => row.key !== key)
        .sort((a, b) => a.touched - b.touched);
      const bytes = JSON.stringify(value).length * 2;
      let size = rows.reduce((n, row) => n + (row.bytes ?? 0), bytes),
        count = rows.length + 1;
      for (const row of rows)
        if (
          row.expires <= Date.now() ||
          size > 20 * 1024 * 1024 ||
          count > 200
        ) {
          store.delete(row.key);
          size -= row.bytes ?? 0;
          count--;
        }
      store.put({
        key,
        value,
        bytes,
        touched: Date.now(),
        expires: Date.now() + 30 * 24 * 3600_000,
      });
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}
export async function pruneMangaJobs(): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("jobs", "readwrite"),
      store = tx.objectStore("jobs"),
      req = store.getAll();
    req.onsuccess = () => {
      const rows = (req.result as MangaJob[])
        .filter(
          (job) =>
            ["ready", "failed", "cancelled", "interrupted"].includes(
              job.phase,
            ) || job.updatedAt < Date.now() - 24 * 3600_000,
        )
        .sort((a, b) => b.updatedAt - a.updatedAt);
      let bytes = 0;
      rows.forEach((job, index) => {
        bytes += JSON.stringify(job).length * 2;
        if (
          index >= 40 ||
          bytes > 8 * 1024 * 1024 ||
          job.updatedAt < Date.now() - 24 * 3600_000
        )
          store.delete(job.id);
      });
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}
