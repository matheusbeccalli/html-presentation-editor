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
