/*
 * drafts.js - crash-recovery drafts kept in the browser (SPEC 6.2, Layer 2).
 *
 * If Edge crashes or the PC restarts before the user saved, the work is not
 * lost: every 30 seconds while there are unsaved changes, a copy of the whole
 * deck (a "draft") goes into the browser's database (storage.js). The last 5
 * drafts per deck are kept.
 *
 * Minimal exposure (SPEC 6.3): every page opened from disk shares the same
 * browser storage, so drafts live only as long as they are needed:
 *   - deleted when the deck is saved, or is back to its saved state (undo),
 *   - deleted when the tab is closed with nothing unsaved,
 *   - deleted when the user discards them,
 *   - and in any case deleted after 1 day (retention, a setting from step 7).
 *
 * Recovery: when the editor starts, or when a deck with newer drafts than its
 * file is opened, a dialog offers Recover / Compare / Discard.
 *
 * Each draft belongs to a deck (by its <meta name="deck-id">, see deck.js)
 * and to a tab ("session"), so closing one tab never deletes the drafts of
 * another tab that has the same deck open. A deck the editor never saved has
 * no id in its file yet, so its drafts are found by file name instead.
 *
 * Talks to: storage.js, autosave.js (reuses its timing scheduler), fileio.js
 *           (current HTML, opening a recovered deck), importer.js, deck.js,
 *           history.js, dialogs.js, thumbnails.js (miniatures), ui.js (status).
 */

(function () {
    'use strict';

    App.drafts = {};

    const KEEP_PER_DECK = 5;
    const DAY = 24 * 60 * 60 * 1000;

    // ---------------------------------------------------------------
    // Pure helpers (tested in tests/unit/drafts.test.js)
    // ---------------------------------------------------------------

    const two = (n) => String(n).padStart(2, '0');

    /* "14:32" in the computer's local time. */
    App.drafts.formatClock = function formatClock(ms) {
        const date = new Date(ms);
        return two(date.getHours()) + ':' + two(date.getMinutes());
    };

    /* "27/10 14:32" (day/month, as in the spec). */
    App.drafts.formatTime = function formatTime(ms) {
        const date = new Date(ms);
        return two(date.getDate()) + '/' + two(date.getMonth() + 1) + ' ' + App.drafts.formatClock(ms);
    };

    const newestFirst = (a, b) => (b.savedAt - a.savedAt) || (b.id - a.id);

    /* The ids of the drafts beyond the newest `keep` of each deck. */
    App.drafts.idsToPrune = function idsToPrune(drafts, keep) {
        const seen = new Map();   // deckId -> how many newer drafts we passed
        const ids = [];
        drafts.slice().sort(newestFirst).forEach((draft) => {
            const count = (seen.get(draft.deckId) || 0) + 1;
            seen.set(draft.deckId, count);
            if (count > keep) {
                ids.push(draft.id);
            }
        });
        return ids.sort((a, b) => a - b);
    };

    /* The ids of drafts older than `days` days at time `now`. */
    App.drafts.expiredIds = function expiredIds(drafts, now, days) {
        return drafts.filter((draft) => now - draft.savedAt > days * DAY).map((draft) => draft.id);
    };

    /* The newest draft of each deck, the most recent deck first. */
    App.drafts.newestPerDeck = function newestPerDeck(drafts) {
        const byDeck = new Map();
        drafts.slice().sort(newestFirst).forEach((draft) => {
            if (!byDeck.has(draft.deckId)) {
                byDeck.set(draft.deckId, draft);
            }
        });
        return Array.from(byDeck.values());
    };

    /* The slides of a document as [{ id, html }], without the editor's own marks. */
    App.drafts.slideList = function slideList(doc) {
        return Array.from(doc.querySelectorAll('section.slide')).map((slide, index) => {
            const copy = slide.cloneNode(true);
            [copy].concat(Array.from(copy.querySelectorAll('*'))).forEach((element) => {
                Array.from(element.attributes).forEach((attribute) => {
                    if (attribute.name.startsWith('data-editor-')) {
                        element.removeAttribute(attribute.name);
                    }
                });
            });
            return { id: slide.getAttribute('data-slide-id') || 'index-' + index, html: copy.outerHTML };
        });
    };

    /*
     * Which slides differ between the saved file (`base`) and a draft?
     * Slides are matched by their id, so an inserted slide does not make
     * every later slide look "changed". Returns
     *   { slides: [{ status: 'changed'|'added'|'removed', baseIndex, draftIndex }],
     *     orderChanged }   (true when the slides both versions share are in another order)
     */
    App.drafts.diffSlides = function diffSlides(base, draft) {
        const baseIndexById = new Map(base.map((slide, index) => [slide.id, index]));
        const draftIds = new Set(draft.map((slide) => slide.id));
        const slides = [];
        draft.forEach((slide, draftIndex) => {
            if (!baseIndexById.has(slide.id)) {
                slides.push({ status: 'added', baseIndex: null, draftIndex: draftIndex });
                return;
            }
            const baseIndex = baseIndexById.get(slide.id);
            if (base[baseIndex].html !== slide.html) {
                slides.push({ status: 'changed', baseIndex: baseIndex, draftIndex: draftIndex });
            }
        });
        base.forEach((slide, baseIndex) => {
            if (!draftIds.has(slide.id)) {
                slides.push({ status: 'removed', baseIndex: baseIndex, draftIndex: null });
            }
        });
        const sharedInBase = base.filter((slide) => draftIds.has(slide.id)).map((slide) => slide.id);
        const sharedInDraft = draft.filter((slide) => baseIndexById.has(slide.id)).map((slide) => slide.id);
        return { slides: slides, orderChanged: sharedInBase.join('\n') !== sharedInDraft.join('\n') };
    };

    // ---------------------------------------------------------------
    // Drafts in the editor
    // ---------------------------------------------------------------

    // Defaults from SPEC 6.3; the Settings dialog (step 7) changes them.
    App.drafts.settings = { keep: true, retentionDays: 1 };

    let interval = 30000;
    let available = false;
    let session = null;      // a random id for this tab
    let deckId = null;       // the deck on screen
    let scheduler = null;

    // Storage calls run one after another, so "delete on save" can never
    // overtake a draft that was being written at that moment.
    let queue = Promise.resolve();
    function serial(task) {
        const run = queue.then(task);
        queue = run.catch((error) => console.warn('Draft task failed:', error));
        return queue;
    }

    App.drafts.init = function init() {
        session = App.deck.newDeckId();
        scheduler = makeScheduler();

        App.events.on('deck-loaded', () => {
            const previous = deckId;
            scheduler.cancel();
            deckId = App.deck.getDeckId();
            if (previous) {
                // The previous deck was saved, or the user agreed to discard its changes.
                serial(() => deleteDeckDrafts(previous, true));
            }
        });
        App.events.on('history-changed', () => {
            if (!App.state.hasDeck) {
                return;
            }
            if (App.history.isDirty()) {
                scheduler.notifyChange();
            } else {
                scheduler.cancel();   // back to the saved version (e.g. by undo): nothing to protect
                serial(() => deleteDeckDrafts(deckId, true));
            }
        });
        // A save makes every draft of this deck useless, whichever tab wrote it.
        App.events.on('saved', () => serial(() => deleteDeckDrafts(deckId, false)));
        App.events.on('file-opened', (info) => {
            offerForOpenedDeck(info.fileName, info.lastModified).catch(reportError);
        });

        // Closing the tab: keep a last draft if changes are unsaved, otherwise remove ours.
        window.addEventListener('beforeunload', () => {
            if (App.state.hasDeck && App.history.isDirty()) {
                scheduler.notifyChange();
                scheduler.flush();
            }
        });
        window.addEventListener('pagehide', () => {
            if (App.state.hasDeck && !App.history.isDirty()) {
                serial(() => deleteDeckDrafts(deckId, true));
            }
        });

        // `ready` resolves once the database is open (tests wait for it).
        App.drafts.ready = start();
        App.drafts.ready.then(() => available && offerAtStartup().catch(reportError));
    };

    async function start() {
        available = await App.storage.open();
        if (!available) {
            App.ui.setStatus('Recovery unavailable');
            return;
        }
        await serial(purgeExpired);
    }

    function reportError(error) {
        console.error(error);
        return App.dialogs.alert('Recovery failed', (error && error.message) || String(error));
    }

    function makeScheduler() {
        // Same timing engine as AutoSave: a draft 30 s after the first unsaved
        // change, then every 30 s while the user keeps editing.
        return App.autosave.createScheduler({
            delay: interval, maxWait: interval, retryMs: 1000,
            isBusy: () => App.history.isPending(),   // not in the middle of a drag
            save: () => serial(writeDraft),
        });
    }

    /* Tests use a short interval instead of 30 s. */
    App.drafts.setInterval = function setInterval(ms) {
        interval = ms;
        scheduler.cancel();
        scheduler = makeScheduler();
    };

    App.drafts.isAvailable = function isAvailable() {
        return available;
    };

    async function writeDraft() {
        if (!available || !App.drafts.settings.keep || !App.state.hasDeck || !App.history.isDirty()) {
            return;
        }
        const savedAt = Date.now();
        const id = await App.storage.addDraft(
            { deckId: deckId, session: session, fileName: App.state.fileName, savedAt: savedAt },
            App.fileio.currentHtml());
        if (id === null) {
            App.ui.setStatus('Could not save a recovery draft');
            return;
        }
        const all = await App.storage.listDrafts();
        const old = App.drafts.idsToPrune(all, KEEP_PER_DECK)
            .concat(App.drafts.expiredIds(all, savedAt, App.drafts.settings.retentionDays));
        await App.storage.deleteDrafts(old);
        App.ui.setStatus('Draft saved ' + App.drafts.formatClock(savedAt));
        App.events.emit('draft-saved', { savedAt: savedAt });
    }

    /* ownOnly: only the drafts this tab wrote. */
    async function deleteDeckDrafts(targetDeckId, ownOnly) {
        if (!available || !targetDeckId) {
            return;
        }
        const drafts = (await App.storage.listDrafts())
            .filter((draft) => draft.deckId === targetDeckId && (!ownOnly || draft.session === session));
        await App.storage.deleteDrafts(drafts.map((draft) => draft.id));
    }

    async function purgeExpired() {
        const all = await App.storage.listDrafts();
        await App.storage.deleteDrafts(App.drafts.expiredIds(all, Date.now(), App.drafts.settings.retentionDays));
    }

    // ---------------------------------------------------------------
    // Offering the drafts back
    // ---------------------------------------------------------------

    /* At startup: drafts left over from a tab that did not close normally. */
    async function offerAtStartup() {
        let groups = [];
        await serial(async () => {
            groups = App.drafts.newestPerDeck(await App.storage.listDrafts());
        });
        for (const newest of groups) {
            if (App.state.hasDeck) {
                return;   // the user opened a deck meanwhile; its drafts are offered on open
            }
            const html = await App.storage.getDraftHtml(newest.id);
            if (html === null) {
                continue;
            }
            const choice = await askToRecover(newest, html, true);
            if (choice === 'recover') {
                await App.fileio.openRecovered(html, newest.fileName);
                afterRecover(newest.deckId);
                return;
            }
            if (choice === 'compare') {
                // Comparing needs the saved file: opening it brings this question back, with Compare.
                App.commands.run('open');
                return;
            }
            if (choice !== 'discard') {
                return;   // "Decide later" or Esc: keep them (until the retention period ends)
            }
            await serial(() => deleteDeckDrafts(newest.deckId, false));
        }
    }

    /* A deck was opened from a file: are there drafts newer than that file? */
    async function offerForOpenedDeck(fileName, fileLastModified) {
        if (!available || !App.state.hasDeck) {
            return;
        }
        const openedDeckId = deckId;
        const byName = !App.deck.hasStoredId();   // never saved by the editor: no id in the file yet
        let newer = [];
        await serial(async () => {
            const drafts = (await App.storage.listDrafts()).filter((draft) => draft.session !== session &&
                (draft.deckId === openedDeckId || (byName && draft.fileName === fileName)));
            // Drafts of this very deck older than the file were overtaken by a later save: remove them.
            const stale = drafts.filter((draft) => draft.deckId === openedDeckId && !(draft.savedAt > fileLastModified));
            await App.storage.deleteDrafts(stale.map((draft) => draft.id));
            newer = drafts.filter((draft) => draft.savedAt > fileLastModified);
        });
        if (newer.length === 0) {
            return;
        }
        const newest = App.drafts.newestPerDeck(newer)[0];
        const html = await App.storage.getDraftHtml(newest.id);
        if (html === null) {
            return;
        }
        let choice = await askToRecover(newest, html, false);
        let imported = null;
        if (choice === 'compare') {
            imported = (await App.importer.importDeck(html)).html;
            choice = await showComparison(newest, imported);
        }
        if (deckId !== openedDeckId) {
            return;   // another deck was opened while the question was open
        }
        if (choice === 'recover') {
            const recovered = imported || (await App.importer.importDeck(html)).html;
            App.history.change('Recover unsaved changes', 'deck', () => App.deck.replaceContent(recovered));
            App.ui.setStatus('Recovered unsaved changes from ' + App.drafts.formatTime(newest.savedAt));
            afterRecover(newest.deckId);
        } else if (choice === 'discard') {
            await serial(() => deleteDeckDrafts(newest.deckId, false));
            App.ui.setStatus('Unsaved changes discarded');
        }
    }

    /* The recovered changes are now this tab's unsaved changes: replace the old drafts with a fresh one. */
    function afterRecover(recoveredDeckId) {
        serial(() => deleteDeckDrafts(recoveredDeckId, false));
        scheduler.notifyChange();
        scheduler.flush();
    }

    function draftDocument(html) {
        return new DOMParser().parseFromString(html, 'text/html');
    }

    /* Resolves 'recover', 'compare', 'discard' or null (decide later). */
    function askToRecover(draft, html, atStartup) {
        const doc = draftDocument(html);
        const name = draft.fileName || 'an untitled deck';
        const explain = atStartup
            ? 'Recover opens them as an unsaved deck; use Save As to keep them. ' +
              'Compare… asks for the saved file first and then shows which slides differ.'
            : 'Recover puts them in place of the deck on screen (Ctrl+Z undoes it). ' +
              'Compare shows which slides differ from the file.';
        const body = App.util.el('div', { class: 'recovery' }, [
            App.util.el('p', {}, ['Unsaved changes to "' + name + '" from ' + App.drafts.formatTime(draft.savedAt) + ' were found.']),
            App.thumbnails.miniature(doc, doc.querySelector('section.slide'), 320),
            App.util.el('p', {}, [explain]),
            App.util.el('p', { class: 'recovery-note' }, [
                'Discard deletes them from this browser. If you decide later, they are deleted after ' +
                retentionText() + '.']),
        ]);
        return App.dialogs.show({
            title: 'Recover unsaved changes?',
            body: body,
            buttons: [
                { label: 'Discard', value: 'discard', danger: true },
                { label: 'Decide later', value: null },
                { label: atStartup ? 'Compare…' : 'Compare', value: 'compare' },
                { label: 'Recover', value: 'recover', primary: true },
            ],
        });
    }

    function retentionText() {
        const days = App.drafts.settings.retentionDays;
        return days === 1 ? '1 day' : days + ' days';
    }

    /* The slides that differ, each as "saved file" and "unsaved changes" miniatures. */
    function showComparison(draft, importedHtml) {
        const baseDoc = App.deck.getDocument();
        const draftDoc = draftDocument(importedHtml);
        const baseSlides = Array.from(baseDoc.querySelectorAll('section.slide'));
        const draftSlides = Array.from(draftDoc.querySelectorAll('section.slide'));
        const diff = App.drafts.diffSlides(App.drafts.slideList(baseDoc), App.drafts.slideList(draftDoc));

        const count = diff.slides.length;
        let summary = count === 0
            ? 'No slide content differs.'
            : count + (count === 1 ? ' slide differs' : ' slides differ') + ' between the file and the unsaved changes from ' +
              App.drafts.formatTime(draft.savedAt) + '.';
        if (diff.orderChanged) {
            summary += ' The order of the slides also changed.';
        }
        const body = App.util.el('div', { class: 'compare' }, [App.util.el('p', {}, [summary])]);
        const labels = { changed: 'changed', added: 'added', removed: 'deleted' };
        diff.slides.forEach((entry) => {
            const number = entry.draftIndex !== null
                ? 'Slide ' + (entry.draftIndex + 1)
                : 'Slide ' + (entry.baseIndex + 1) + ' of the file';
            const side = (doc, slide, caption) => App.util.el('figure', { class: 'compare-side' }, [
                App.thumbnails.miniature(doc, slide || null, 240),
                App.util.el('figcaption', {}, [caption]),
            ]);
            body.appendChild(App.util.el('section', { class: 'compare-row', 'data-status': entry.status }, [
                App.util.el('h3', {}, [number + ' — ' + labels[entry.status]]),
                App.util.el('div', { class: 'compare-pair' }, [
                    side(baseDoc, entry.baseIndex === null ? null : baseSlides[entry.baseIndex], 'In the file'),
                    side(draftDoc, entry.draftIndex === null ? null : draftSlides[entry.draftIndex], 'Unsaved changes'),
                ]),
            ]));
        });
        return App.dialogs.show({
            title: 'Compare with the file',
            body: body,
            wide: true,
            buttons: [
                { label: 'Discard', value: 'discard', danger: true },
                { label: 'Decide later', value: null },
                { label: 'Recover', value: 'recover', primary: true },
            ],
        });
    }
})();
