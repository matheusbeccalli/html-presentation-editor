/*
 * storage.js - the editor's own small database in the browser (IndexedDB),
 * used for crash-recovery drafts (SPEC 6.2) and, later, Recent files.
 *
 * Why IndexedDB: localStorage holds only about 5 MB, too little for a deck
 * with embedded pictures.
 *
 * Rule: the editor must keep working when storage is blocked (company policy,
 * private window ...). So nothing here ever throws. Every function returns a
 * safe value instead: false, null or an empty list, and the caller shows
 * "Recovery unavailable" (SPEC 6.3).
 *
 * The database has three stores:
 *   drafts     one small record per draft: { id, deckId, session, fileName, savedAt }
 *   draftHtml  the draft's full deck HTML, under the same id (kept apart so
 *              listing the drafts does not read megabytes of pictures)
 *   recent     Recent files, only when the user turned them on: { id, name, openedAt, handle }
 *
 * Talks to: drafts.js (the only user so far).
 */

(function () {
    'use strict';

    App.storage = {};

    const DEFAULT_NAME = 'deck-editor';
    const VERSION = 1;
    const STORES = ['drafts', 'draftHtml', 'recent'];

    let db = null;

    // IndexedDB reports results through callbacks; wrap them as Promises so we can use await.
    function done(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    function finished(transaction) {
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error('transaction aborted'));
        });
    }

    /*
     * Open (or create) the database. Resolves true when it can be used.
     * options: { name, indexedDB } - tests pass their own name or a fake factory.
     */
    App.storage.open = async function open(options) {
        const settings = options || {};
        const factory = 'indexedDB' in settings ? settings.indexedDB : safeFactory();
        db = null;
        if (!factory) {
            return false;
        }
        try {
            const request = factory.open(settings.name || DEFAULT_NAME, VERSION);
            request.onupgradeneeded = () => {
                const database = request.result;
                if (!database.objectStoreNames.contains('drafts')) {
                    database.createObjectStore('drafts', { keyPath: 'id', autoIncrement: true });
                }
                if (!database.objectStoreNames.contains('draftHtml')) {
                    database.createObjectStore('draftHtml');
                }
                if (!database.objectStoreNames.contains('recent')) {
                    database.createObjectStore('recent', { keyPath: 'id', autoIncrement: true });
                }
            };
            db = await done(request);
            return true;
        } catch (error) {
            console.warn('Storage unavailable:', error);
            db = null;
            return false;
        }
    };

    // Merely reading window.indexedDB can throw where storage is blocked.
    function safeFactory() {
        try {
            return window.indexedDB || null;
        } catch (error) {
            return null;
        }
    }

    App.storage.isAvailable = function isAvailable() {
        return db !== null;
    };

    App.storage.close = function close() {
        if (db) {
            db.close();
        }
        db = null;
    };

    // Run `work(transaction)` and return its result, or `fallback` if anything fails.
    async function attempt(storeNames, mode, fallback, work) {
        if (!db) {
            return fallback;
        }
        try {
            const transaction = db.transaction(storeNames, mode);
            const complete = finished(transaction);
            complete.catch(() => {});   // handled by the await below; avoids an "unhandled" warning if work() throws first
            const result = await work(transaction);
            await complete;              // the data is only safely stored once the transaction completes
            return result;
        } catch (error) {
            console.warn('Storage call failed:', error);
            return fallback;
        }
    }

    /* Store a draft. meta = { deckId, session, fileName, savedAt }. Resolves the new id, or null. */
    App.storage.addDraft = function addDraft(meta, html) {
        return attempt(['drafts', 'draftHtml'], 'readwrite', null, async (transaction) => {
            const id = await done(transaction.objectStore('drafts').add(Object.assign({}, meta)));
            transaction.objectStore('draftHtml').put(html, id);
            return id;
        });
    };

    /* Every draft's small record (without the HTML). */
    App.storage.listDrafts = function listDrafts() {
        return attempt(['drafts'], 'readonly', [], (transaction) => done(transaction.objectStore('drafts').getAll()));
    };

    App.storage.getDraftHtml = function getDraftHtml(id) {
        return attempt(['draftHtml'], 'readonly', null, async (transaction) => {
            const html = await done(transaction.objectStore('draftHtml').get(id));
            return html === undefined ? null : html;
        });
    };

    App.storage.deleteDrafts = function deleteDrafts(ids) {
        if (db && ids.length === 0) {
            return Promise.resolve(true);
        }
        return attempt(['drafts', 'draftHtml'], 'readwrite', false, (transaction) => {
            ids.forEach((id) => {
                transaction.objectStore('drafts').delete(id);
                transaction.objectStore('draftHtml').delete(id);
            });
            return true;
        });
    };

    // Recent files (recent.js): { id, name, openedAt, handle }. Chromium can keep a
    // file handle in IndexedDB; it remembers the file's place, not its content.

    App.storage.addRecent = function addRecent(record) {
        return attempt(['recent'], 'readwrite', null, (transaction) =>
            done(transaction.objectStore('recent').add(Object.assign({}, record))));
    };

    App.storage.listRecent = function listRecent() {
        return attempt(['recent'], 'readonly', [], (transaction) => done(transaction.objectStore('recent').getAll()));
    };

    App.storage.deleteRecent = function deleteRecent(ids) {
        if (db && ids.length === 0) {
            return Promise.resolve(true);
        }
        return attempt(['recent'], 'readwrite', false, (transaction) => {
            ids.forEach((id) => transaction.objectStore('recent').delete(id));
            return true;
        });
    };

    App.storage.clearRecent = function clearRecent() {
        return attempt(['recent'], 'readwrite', false, (transaction) => {
            transaction.objectStore('recent').clear();
            return true;
        });
    };

    /* "Delete all drafts now": empty every store (SPEC 6.3). */
    App.storage.clearAll = function clearAll() {
        return attempt(STORES, 'readwrite', false, (transaction) => {
            STORES.forEach((name) => transaction.objectStore(name).clear());
            return true;
        });
    };
})();
