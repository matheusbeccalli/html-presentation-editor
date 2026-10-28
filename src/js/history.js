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
 * Scope of a change:
 *   { slideId: 's3' }  -> snapshot of that slide only (fast, the common case)
 *   'deck'             -> snapshot of the whole <head> and <body> (theme,
 *                         adding/removing slides, removing blocked fonts ...)
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

    function takeSnapshot(scope) {
        const doc = getDoc();
        if (scope === 'deck') {
            return { head: doc.head.innerHTML, body: doc.body.innerHTML };
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
        // Setting outerHTML replaces the slide element with one parsed from the string.
        findSlide(doc, scope.slideId).outerHTML = snapshot;
    }

    function validateScope(scope) {
        if (scope !== 'deck' && !(scope && scope.slideId)) {
            throw new Error("History scope must be 'deck' or { slideId: '...' }");
        }
    }

    // ---- Recording ----

    function push(label, scope, before) {
        const entry = {
            label: label, scope: scope, before: before, after: null,
            stateBefore: currentState, stateAfter: nextStateNumber,
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
     * Run `fn`, which changes the deck, as one undoable step.
     * If `fn` throws, the deck is put back as it was and nothing is recorded.
     */
    function change(label, scope, fn) {
        validateScope(scope);
        const before = takeSnapshot(scope);
        try {
            fn();
        } catch (error) {
            restoreSnapshot(scope, before);
            throw error;
        }
        push(label, scope, before);
    }

    function begin(label, scope) {
        validateScope(scope);
        pending = { label: label, scope: scope, before: takeSnapshot(scope) };
    }

    function commit() {
        if (!pending) {
            return;
        }
        const p = pending;
        pending = null;
        push(p.label, p.scope, p.before);
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
        const entry = undoStack.pop();
        if (!entry) {
            return false;
        }
        entry.after = takeSnapshot(entry.scope);   // remember the state so redo can return to it
        restoreSnapshot(entry.scope, entry.before);
        currentState = entry.stateBefore;
        redoStack.push(entry);
        onChange({ action: 'undo', label: entry.label, scope: entry.scope });
        return true;
    }

    function redo() {
        const entry = redoStack.pop();
        if (!entry) {
            return false;
        }
        restoreSnapshot(entry.scope, entry.after);
        currentState = entry.stateAfter;
        undoStack.push(entry);
        onChange({ action: 'redo', label: entry.label, scope: entry.scope });
        return true;
    }

    // ---- Saved state ----

    function markSaved() {
        savedState = currentState;
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
        canUndo: () => undoStack.length > 0,
        canRedo: () => redoStack.length > 0,
        isDirty: () => currentState !== savedState,
        undoLabel: () => (undoStack.length ? undoStack[undoStack.length - 1].label : null),
        redoLabel: () => (redoStack.length ? redoStack[redoStack.length - 1].label : null),
    };
};
