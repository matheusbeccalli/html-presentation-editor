/*
 * history.js - undo / redo for every change to the deck (SPEC 4, Phase 1).
 *
 * Approach (from the spec): before each change, take a snapshot (a copy of
 * the HTML) of the part that is about to change, usually one slide. Undo puts
 * the snapshot back. Snapshots are plain strings, so they are cheap to keep
 * and impossible to get "half restored". At most `limit` (100) steps are kept.
 *
 * Every later feature records its changes through this module:
 *
 *     App.history.change('Move element', { slideId: 's3' }, () => {
 *         element.style.left = '100px';
 *     });
 *
 * For long interactions such as a drag (Phase 2), call begin() when the drag
 * starts and commit() when it ends, so the whole drag is one undo step.
 *
 * Merging: change(label, scope, fn, { mergeKey: 'nudge:e3' }) joins the
 * previous step when that step has the same mergeKey and is less than a
 * second old. Holding an arrow key fires ~30 nudges a second; this makes them
 * one undo step instead of filling the 100-step history.
 *
 * Scope of a change:
 *   { slideId: 's3' }  -> snapshot of that slide only (fast, the common case)
 *   { slides: ['s7'] } -> the slide order, plus a copy of the slides listed
 *                         (Phase 7: adding, duplicating, deleting slides; the
 *                         list is the slide that comes or goes, [] to reorder).
 *                         The other slides are not copied: undo puts the live
 *                         ones back in the old order, so a 20 MB deck stays cheap.
 *   'deck'             -> snapshot of the whole <head> and <body> (theme,
 *                         Replace All, removing blocked fonts ...)
 *
 * Meta (Phase 3): a step may carry `meta`, any object the caller wants back
 * when the step is undone or redone (text editing keeps the cursor position
 * there). The 'undo' / 'redo' events include it.
 *
 * A pending step (begin() without commit(), e.g. typing in a text box) is
 * committed automatically before any other change, undo or redo, so steps
 * always stay in the order they happened.
 *
 * Dirty tracking: every state gets a number. The state saved to disk is
 * remembered; the deck is "dirty" (has unsaved changes) when the current
 * state number differs from the saved one. So undoing back to the saved
 * state makes it clean again.
 *
 * Talks to: deck.js (through getDoc), app.js (onChange -> 'history-changed').
 */

App.createHistory = function createHistory(options) {
    const getDoc = options.getDoc;
    const limit = options.limit || 100;
    const onChange = options.onChange || function () {};
    const now = options.now || (() => Date.now());   // tests pass a fake clock
    const MERGE_WINDOW_MS = 1000;

    let undoStack = [];      // entries: { label, scope, before, after, stateBefore, stateAfter }
    let redoStack = [];
    let nextStateNumber = 1;
    let currentState = 0;    // 0 = the state the deck had when it was opened
    let savedState = 0;
    let pending = null;      // an interaction started with begin() and not yet committed

    // ---- Snapshots ----

    function findSlide(doc, slideId) {
        const slide = doc.querySelector('[data-slide-id="' + CSS.escape(slideId) + '"]');
        if (!slide) {
            throw new Error('Undo: slide "' + slideId + '" not found');
        }
        return slide;
    }

    function slidesOf(doc) {
        return Array.from(doc.querySelectorAll('section.slide'));
    }

    /* The slide order, and the HTML of the listed slides that exist now. */
    function takeSlides(doc, listed) {
        const slides = slidesOf(doc);
        const html = {};
        slides.filter((slide) => listed.includes(slide.getAttribute('data-slide-id')))
            .forEach((slide) => { html[slide.getAttribute('data-slide-id')] = slide.outerHTML; });
        return { order: slides.map((slide) => slide.getAttribute('data-slide-id')), html: html };
    }

    /*
     * Put the slides back in the snapshot's order: a listed slide from its copy
     * (or gone, if it had none), any other one is the live slide. They go where
     * the first slide is now, so the master and other blocks keep their place.
     */
    function restoreSlides(doc, snapshot) {
        const live = new Map(slidesOf(doc).map((slide) => [slide.getAttribute('data-slide-id'), slide]));
        const wanted = snapshot.order.map((id) => {
            if (Object.prototype.hasOwnProperty.call(snapshot.html, id)) {
                const template = doc.createElement('template');
                template.innerHTML = snapshot.html[id];
                return doc.importNode(template.content.firstElementChild, true);
            }
            if (!live.has(id)) {
                throw new Error('Undo: slide "' + id + '" not found');
            }
            return live.get(id);
        });
        const first = live.size ? live.values().next().value : null;
        const marker = doc.createComment('slides');
        if (first) {
            first.before(marker);
        } else {
            doc.body.appendChild(marker);
        }
        live.forEach((slide) => slide.remove());
        wanted.forEach((slide) => marker.before(slide));
        marker.remove();
    }

    function takeSnapshot(scope) {
        const doc = getDoc();
        if (scope === 'deck') {
            return { head: doc.head.innerHTML, body: doc.body.innerHTML };
        }
        if (scope.slides) {
            return takeSlides(doc, scope.slides);
        }
        return findSlide(doc, scope.slideId).outerHTML;
    }

    function restoreSnapshot(scope, snapshot) {
        const doc = getDoc();
        if (scope === 'deck') {
            doc.head.innerHTML = snapshot.head;
            doc.body.innerHTML = snapshot.body;
            return;
        }
        if (scope.slides) {
            restoreSlides(doc, snapshot);
            return;
        }
        // Setting outerHTML replaces the slide element with one parsed from the string.
        findSlide(doc, scope.slideId).outerHTML = snapshot;
    }

    function validateScope(scope) {
        if (scope !== 'deck' && !(scope && (scope.slideId || Array.isArray(scope.slides)))) {
            throw new Error("History scope must be 'deck', { slideId: '...' } or { slides: [...] }");
        }
    }

    // ---- Recording ----

    function push(label, scope, before, mergeKey, meta) {
        const entry = {
            label: label, scope: scope, before: before, after: null,
            stateBefore: currentState, stateAfter: nextStateNumber,
            mergeKey: mergeKey || null, time: now(), meta: meta || null,
        };
        nextStateNumber += 1;
        currentState = entry.stateAfter;
        undoStack.push(entry);
        if (undoStack.length > limit) {
            undoStack.shift();   // forget the oldest step
        }
        redoStack = [];
        onChange({ action: 'change', label: label, scope: scope });
    }

    /*
     * Can a change with this mergeKey join the last step? Only if that step is
     * the current state (nothing undone since), has the same key, is recent,
     * and was not saved: a change after a save must make the deck dirty again.
     */
    function canMerge(mergeKey) {
        const last = undoStack[undoStack.length - 1];
        return !!mergeKey && !!last && last.mergeKey === mergeKey &&
            currentState === last.stateAfter && savedState !== currentState &&
            now() - last.time < MERGE_WINDOW_MS;
    }

    /*
     * Run `fn`, which changes the deck, as one undoable step.
     * If `fn` throws, the deck is put back as it was and nothing is recorded.
     * options.mergeKey: see "Merging" at the top of this file; options.meta: see "Meta".
     */
    function change(label, scope, fn, changeOptions) {
        validateScope(scope);
        commit();   // a pending step (typing) happened first
        const mergeKey = changeOptions && changeOptions.mergeKey;
        const meta = changeOptions && changeOptions.meta;
        const before = takeSnapshot(scope);
        try {
            fn();
        } catch (error) {
            restoreSnapshot(scope, before);
            throw error;
        }
        if (canMerge(mergeKey)) {
            // Keep the older "before" snapshot; just refresh the time window.
            undoStack[undoStack.length - 1].time = now();
            onChange({ action: 'change', label: label, scope: scope, merged: true });
            return;
        }
        push(label, scope, before, mergeKey, meta);
    }

    /*
     * Start a step whose changes happen later (a drag, typing). options.meta is
     * stored with the step; options.onCommit() runs just before it is recorded
     * (text editing notes where the cursor ended up).
     */
    function begin(label, scope, beginOptions) {
        validateScope(scope);
        commit();
        pending = {
            label: label, scope: scope, before: takeSnapshot(scope),
            meta: beginOptions && beginOptions.meta, onCommit: beginOptions && beginOptions.onCommit,
        };
    }

    function commit() {
        if (!pending) {
            return;
        }
        const p = pending;
        pending = null;
        if (p.onCommit) {
            p.onCommit();
        }
        push(p.label, p.scope, p.before, null, p.meta);
    }

    function cancel() {
        if (!pending) {
            return;
        }
        restoreSnapshot(pending.scope, pending.before);
        pending = null;
    }

    // ---- Undo / redo ----

    function undo() {
        commit();
        const entry = undoStack.pop();
        if (!entry) {
            return false;
        }
        entry.after = takeSnapshot(entry.scope);   // remember the state so redo can return to it
        restoreSnapshot(entry.scope, entry.before);
        currentState = entry.stateBefore;
        redoStack.push(entry);
        onChange({ action: 'undo', label: entry.label, scope: entry.scope, meta: entry.meta });
        return true;
    }

    function redo() {
        commit();
        const entry = redoStack.pop();
        if (!entry) {
            return false;
        }
        restoreSnapshot(entry.scope, entry.after);
        currentState = entry.stateAfter;
        undoStack.push(entry);
        onChange({ action: 'redo', label: entry.label, scope: entry.scope, meta: entry.meta });
        return true;
    }

    // ---- Saved state ----

    /*
     * Remember which state is on disk. Saving is asynchronous: pass the
     * stateId() taken when the deck was turned into text, so edits made while
     * the file was being written still count as unsaved.
     */
    function markSaved(stateId) {
        savedState = stateId === undefined ? currentState : stateId;
        onChange({ action: 'saved' });
    }

    // The deck differs from the file even without an undoable step,
    // e.g. right after a messy deck was normalized on import.
    function markDirty() {
        savedState = -1;
        onChange({ action: 'dirty' });
    }

    function reset() {
        undoStack = [];
        redoStack = [];
        pending = null;
        nextStateNumber = 1;
        currentState = 0;
        savedState = 0;
        onChange({ action: 'reset' });
    }

    return {
        change: change, begin: begin, commit: commit, cancel: cancel,
        undo: undo, redo: redo, reset: reset, markSaved: markSaved, markDirty: markDirty,
        stateId: () => currentState,
        isPending: () => pending !== null,
        canUndo: () => undoStack.length > 0 || pending !== null,   // undo() commits a pending step first
        canRedo: () => redoStack.length > 0,
        isDirty: () => currentState !== savedState,
        undoLabel: () => (pending ? pending.label : undoStack.length ? undoStack[undoStack.length - 1].label : null),
        redoLabel: () => (redoStack.length ? redoStack[redoStack.length - 1].label : null),
    };
};
