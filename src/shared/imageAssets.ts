/** Binary images live in the extension origin, never in chrome.storage or a page DOM. */
export interface ImageAsset {
  id: string;
  owner: string;
  blob: Blob;
  preview: string;
  bytes: number;
  touched: number;
  expires: number;
}
const ASSET_BUDGET = 128 * 1024 * 1024;
let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  if (!database)
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("astra_image_assets_v1", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("assets", { keyPath: "id" });
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
export async function putImageAsset(
  blob: Blob,
  owner: string,
  preview = "",
): Promise<string> {
  if (blob.size > 32 * 1024 * 1024) throw new Error("IMAGE_TOO_LARGE");
  const db = await open();
  const now = Date.now();
  const asset: ImageAsset = {
    id: crypto.randomUUID(),
    owner,
    blob,
    preview,
    bytes: blob.size + preview.length * 2,
    touched: now,
    expires: now + 24 * 3600_000,
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("assets", "readwrite");
    const store = tx.objectStore("assets");
    const request = store.getAll();
    request.onsuccess = () => {
      const rows = (request.result as ImageAsset[]).sort(
        (a, b) => a.touched - b.touched,
      );
      let size = rows.reduce((n, a) => n + a.bytes, asset.bytes);
      for (const row of rows)
        if (row.expires <= now || size > ASSET_BUDGET) {
          store.delete(row.id);
          size -= row.bytes;
        }
      store.put(asset);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error("IMAGE_STORAGE_FAILED"));
  });
  return asset.id;
}
export async function getImageAsset(
  id: string,
  owner: string,
): Promise<ImageAsset | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("assets", "readwrite");
    const store = tx.objectStore("assets");
    const request = store.get(id);
    let found: ImageAsset | undefined;
    request.onsuccess = () => {
      const row = request.result as ImageAsset | undefined;
      if (!row || row.owner !== owner) return;
      if (row.expires <= Date.now()) {
        store.delete(id);
        return;
      }
      found = { ...row, touched: Date.now() };
      store.put(found);
    };
    tx.oncomplete = () => resolve(found);
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error("IMAGE_STORAGE_FAILED"));
  });
}
export async function removeImageAssets(
  ids: string[],
  owner: string,
): Promise<void> {
  if (!ids.length) return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("assets", "readwrite");
    const store = tx.objectStore("assets");
    for (const id of new Set(ids)) {
      const request = store.get(id);
      request.onsuccess = () => {
        if (request.result?.owner === owner) store.delete(id);
      };
    }
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error("IMAGE_STORAGE_FAILED"));
  });
}
export function imageDataUrlToBlob(
  dataUrl: string,
  maxBytes = 4 * 1024 * 1024,
): Blob {
  const match =
    /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-zA-Z0-9+/]*={0,2})$/.exec(
      dataUrl,
    );
  if (!match || !match[2]) throw new Error("IMAGE_INVALID");
  if (match[2].length * 0.75 > maxBytes + 2) throw new Error("IMAGE_TOO_LARGE");
  const raw = atob(match[2]);
  const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  if (bytes.length > maxBytes) throw new Error("IMAGE_TOO_LARGE");
  return new Blob([bytes], { type: match[1] });
}
export async function imageBlobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return "data:" + blob.type + ";base64," + btoa(binary);
}
export async function imagePreview(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width * bitmap.height > 40_000_000)
      throw new Error("IMAGE_TOO_LARGE");
    const scale = Math.min(1, 192 / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("IMAGE_INVALID");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return imageBlobToDataUrl(
      await canvas.convertToBlob({ type: "image/jpeg", quality: 0.65 }),
    );
  } finally {
    bitmap.close();
  }
}

/** Remove expired files and chat images whose session references no longer exist. */
export async function pruneImageAssets(
  retainedChatIds: ReadonlySet<string>,
  chatPrefix: string,
): Promise<void> {
  if (
    typeof indexedDB.databases === "function" &&
    !(await indexedDB.databases()).some(
      (db) => db.name === "astra_image_assets_v1",
    )
  )
    return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("assets", "readwrite"),
      store = tx.objectStore("assets"),
      request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const asset = cursor.value as ImageAsset;
      const chatOwned =
        asset.owner === chatPrefix || asset.owner.startsWith(chatPrefix + ":");
      if (
        asset.expires <= Date.now() ||
        (chatOwned && !retainedChatIds.has(asset.id))
      )
        cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}
