const DB_NAME = "ruta-verde-offline";
const DB_VERSION = 1;

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB"));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("journeys")) database.createObjectStore("journeys");
      if (!database.objectStoreNames.contains("outbox")) database.createObjectStore("outbox");
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function readStored<T>(storeName: "journeys" | "outbox", key: string) {
  const database = await openDatabase();
  return new Promise<T | null>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(key);
    request.onerror = () => reject(request.error ?? new Error("No se pudo leer el almacenamiento"));
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    transaction.oncomplete = () => database.close();
  });
}

export async function writeStored<T>(storeName: "journeys" | "outbox", key: string, value: T) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value, key);
    transaction.onerror = () => reject(transaction.error ?? new Error("No se pudo guardar en el teléfono"));
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
  });
}

export async function deleteStored(storeName: "journeys" | "outbox", key: string) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(key);
    transaction.onerror = () => reject(transaction.error ?? new Error("No se pudo limpiar el almacenamiento"));
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
  });
}
