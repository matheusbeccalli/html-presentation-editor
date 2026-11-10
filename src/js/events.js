/*
 * events.js - a tiny publish/subscribe "event bus".
 *
 * Modules announce that something happened (App.events.emit('deck-loaded'))
 * without knowing who cares. Other modules listen (App.events.on(...)).
 * This keeps, for example, history.js from having to know about thumbnails.
 *
 * Events used in Phase 1:
 *   'deck-loaded'      a deck was opened or created          (deck.js)
 *   'slide-changed'    the current slide changed             (deck.js)
 *   'history-changed'  a change, undo or redo happened       (history.js via app.js)
 *   'saved'            the deck was written to disk          (fileio.js)
 *
 * Added in Phase 2:
 *   'selection-changed' another element (or none, or several: { id, ids }) was selected (selection.js)
 *   'clipboard-changed' something was copied, Paste can run    (elements.js)
 *   'selection-dragged' the selected element moves during a drag (selection.js)
 *   'zoom-changed'      the canvas zoom changed                (canvas.js)
 *   'autosave-changed'  AutoSave was switched on or off        (autosave.js)
 *   'file-opened'       a deck was opened from a file, { lastModified } (fileio.js)
 *   'drafts-changed'    a draft was stored, or drafts became (un)available (drafts.js)
 *   'drafts-cleared'    "Delete all drafts now" emptied the database (drafts.js)
 *   'settings-changed'  File > Settings changed, { before, after } (settings.js)
 *   'recent-changed'    the Recent files list changed          (recent.js)
 *   'saving'            a write to the file started or ended, { active } (fileio.js)
 *
 * Talks to: nothing (others call it). Created in app.js as App.events.
 */

App.createEventBus = function createEventBus() {
    const listeners = new Map();   // event name -> array of functions

    function on(name, fn) {
        if (!listeners.has(name)) {
            listeners.set(name, []);
        }
        listeners.get(name).push(fn);
    }

    function off(name, fn) {
        const list = listeners.get(name) || [];
        listeners.set(name, list.filter((item) => item !== fn));
    }

    function emit(name, data) {
        // Copy the list so a listener that calls off() does not disturb the loop.
        const list = (listeners.get(name) || []).slice();
        list.forEach((fn) => {
            // One broken listener must not stop the others (e.g. thumbnails failing
            // should not stop the title bar from updating).
            try {
                fn(data);
            } catch (error) {
                console.error('Listener for "' + name + '" failed:', error);
            }
        });
    }

    return { on: on, off: off, emit: emit };
};
