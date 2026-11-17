// A whole workspace + outbox is one IndexedDB transaction. Never touch legacy keys.
export class WorkspaceStore {
  constructor(key, indexedDBImpl = globalThis.indexedDB) { this.key = key; this.idb = indexedDBImpl; }
  async open() {
    if (this.database) return this.database;
    this.database = await new Promise((resolve, reject) => {
      const request = this.idb.open('TR_SECURE_WORKSPACES_V15', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('workspaces');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.database;
  }
  async read() {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const request = database.transaction('workspaces').objectStore('workspaces').get(this.key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }
  async write(value, expectedGeneration) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('workspaces', 'readwrite');
      const store = tx.objectStore('workspaces');
      let conflict = false;
      const get = store.get(this.key);
      get.onsuccess = () => {
        if ((get.result?.generation || 0) !== expectedGeneration) { conflict = true; tx.abort(); return; }
        store.put(structuredClone(value), this.key);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(new Error(conflict ? 'LOCAL_WORKSPACE_CONFLICT' : 'LOCAL_STORAGE_FAILED'));
    });
  }
}
