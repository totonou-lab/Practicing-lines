// 台本をこの端末のブラウザ内 (IndexedDB) に保存する
(function (global) {
  'use strict';

  const DB_NAME = 'line-rehearsal';
  const STORE = 'scripts';
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  global.ScriptDB = {
    all: () => run('readonly', s => s.getAll()),
    get: id => run('readonly', s => s.get(id)),
    put: script => run('readwrite', s => s.put(script)),
    remove: id => run('readwrite', s => s.delete(id)),
  };

  // ブラウザが容量不足のときに勝手にデータを消さないよう依頼する
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
})(window);
