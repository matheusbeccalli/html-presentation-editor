/*
 * deck.js - owns the live deck: the iframe in the centre of the screen (SPEC 3.5).
 *
 * The deck is shown in <iframe sandbox="allow-same-origin">. "allow-same-origin"
 * lets the editor's code read and change the deck's DOM; the missing
 * "allow-scripts" means no script inside the deck can ever run. The deck DOM
 * in that iframe is the single source of truth: thumbnails, saving and undo
 * all read from it.
 *
 * To show one slide at a time, deck.js adds one <style data-editor-only> to the
 * deck. serialize.js removes it again on save. The current slide carries the
 * attribute data-editor-current (also stripped on save).
 *
 * Deck id (SPEC 6.2): every deck gets <meta name="deck-id"> as soon as it is
 * shown, so crash-recovery drafts find the right deck even if the file is
 * renamed. Adding it does not count as a change; it reaches the file with the
 * next save. Until then hasStoredId() is false, and drafts.js matches drafts
 * by file name instead.
 *
 * Talks to: canvas.js (sizes the iframe), thumbnails.js, ui.js (via events),
 *           shortcuts.js (key presses inside the iframe), fileio.js (drag & drop).
 */

(function () {
    'use strict';

    App.deck = {};

    let frame = null;
    let doc = null;
    let currentIndex = 0;
    let storedId = false;   // did the deck's file already carry its deck id?

    // Rules that only exist while editing. !important beats the deck's own rules,
    // e.g. Copilot decks that hide every slide except ".active".
    App.deck.VIEW_CSS = [
        'html, body { margin: 0 !important; padding: 0 !important; width: 1280px !important;',
        '  height: 720px !important; overflow: hidden !important; }',
        '.slide { display: none !important; }',
        '.slide[data-editor-current] { display: block !important; position: absolute !important;',
        '  left: 0 !important; top: 0 !important; margin: 0 !important; transform: none !important;',
        '  opacity: 1 !important; visibility: visible !important; }',
        'aside.notes, .master { display: none !important; }',
        '*, *::before, *::after { animation: none !important; transition: none !important; }',
        // Find & replace paints its matches with the CSS Highlight API (findreplace.js), as the browser's own find does.
        '::highlight(editor-find) { background-color: #ffe14d; }',
        '::highlight(editor-find-current) { background-color: #ff9632; }',
    ].join('\n');

    App.deck.init = function init() {
        frame = document.getElementById('deck-frame');
        // An undo of a deck-wide change rebuilds the body, so put the current-slide mark back.
        App.events.on('history-changed', () => {
            if (doc) {
                App.deck.goTo(currentIndex);
            }
        });
    };

    // ---------------------------------------------------------------
    // Deck id (tested in tests/unit/drafts.test.js)
    // ---------------------------------------------------------------

    /* 32 random hex characters. crypto.getRandomValues works on file:// pages too. */
    App.deck.newDeckId = function newDeckId() {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    };

    /*
     * Make sure `targetDoc` has a deck id and return it. A missing id becomes
     * `fallbackId` (the id the deck had before its content was replaced), or a new one.
     */
    App.deck.ensureDeckId = function ensureDeckId(targetDoc, fallbackId) {
        let meta = targetDoc.head.querySelector('meta[name="deck-id"]');
        if (meta && meta.getAttribute('content')) {
            return meta.getAttribute('content');
        }
        if (!meta) {
            meta = targetDoc.createElement('meta');
            meta.setAttribute('name', 'deck-id');
            const format = targetDoc.head.querySelector('meta[name="deck-format"]');
            if (format) {
                format.after(meta);
            } else {
                targetDoc.head.prepend(meta);
            }
        }
        meta.setAttribute('content', fallbackId || App.deck.newDeckId());
        return meta.getAttribute('content');
    };

    App.deck.getDeckId = function getDeckId() {
        const meta = doc && doc.head.querySelector('meta[name="deck-id"]');
        return meta ? meta.getAttribute('content') : null;
    };

    App.deck.hasStoredId = function hasStoredId() {
        return storedId;
    };

    function addEditorView(targetDoc) {
        const style = targetDoc.createElement('style');
        style.setAttribute('data-editor-only', '');
        style.textContent = App.deck.VIEW_CSS;
        targetDoc.head.appendChild(style);
    }

    /*
     * Load deck HTML (already imported/normalized) into the canvas iframe.
     * Returns a Promise that resolves once the deck is ready to use.
     */
    App.deck.load = function load(html) {
        return new Promise((resolve) => {
            frame.addEventListener('load', () => {
                doc = frame.contentDocument;
                const meta = doc.head.querySelector('meta[name="deck-id"]');
                storedId = !!(meta && meta.getAttribute('content'));
                App.deck.ensureDeckId(doc, null);
                addEditorView(doc);
                App.shortcuts.listenTo(frame.contentWindow);
                App.fileio.listenForDrops(frame.contentWindow);
                currentIndex = 0;
                App.state.hasDeck = true;
                App.deck.goTo(0, { silent: true });
                App.events.emit('deck-loaded');
                resolve();
            }, { once: true });
            frame.srcdoc = html;
        });
    };

    /*
     * Replace the whole deck (head and body) with `html`, keeping the editor's
     * view CSS and the deck id (it is still the same deck). Used by "Revert to
     * version opened" and by recovering a draft; call it inside
     * history.change(..., 'deck', ...) so it can be undone.
     */
    App.deck.replaceContent = function replaceContent(html) {
        const deckId = App.deck.getDeckId();
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        doc.head.innerHTML = parsed.head.innerHTML;
        doc.body.innerHTML = parsed.body.innerHTML;
        doc.head.querySelectorAll('meta[name="deck-id"]').forEach((meta) => meta.remove());
        App.deck.ensureDeckId(doc, deckId);
        addEditorView(doc);
    };

    App.deck.getDocument = function getDocument() {
        return doc;
    };

    App.deck.getSlides = function getSlides() {
        return doc ? Array.from(doc.querySelectorAll('section.slide')) : [];
    };

    App.deck.getCurrentIndex = function getCurrentIndex() {
        return currentIndex;
    };

    App.deck.getCurrentSlide = function getCurrentSlide() {
        return App.deck.getSlides()[currentIndex] || null;
    };

    /* Show slide number `index` (0-based) on the canvas. */
    App.deck.goTo = function goTo(index, options) {
        const slides = App.deck.getSlides();
        if (slides.length === 0) {
            return;
        }
        currentIndex = Math.max(0, Math.min(slides.length - 1, index));
        slides.forEach((slide, i) => slide.toggleAttribute('data-editor-current', i === currentIndex));
        if (!(options && options.silent)) {
            App.events.emit('slide-changed', { index: currentIndex });
        }
    };

    /*
     * Run fn with `slide` shown instead of the current one, e.g. to measure a
     * text box on another slide (autofit after Replace All); then show the current one again.
     */
    App.deck.withSlideShown = function withSlideShown(slide, fn) {
        const current = App.deck.getCurrentSlide();
        if (slide === current) {
            return fn();
        }
        if (current) {
            current.removeAttribute('data-editor-current');
        }
        slide.setAttribute('data-editor-current', '');
        try {
            return fn();
        } finally {
            slide.removeAttribute('data-editor-current');
            if (current) {
                current.setAttribute('data-editor-current', '');
            }
        }
    };

    App.deck.next = () => App.deck.goTo(currentIndex + 1);
    App.deck.previous = () => App.deck.goTo(currentIndex - 1);
    App.deck.first = () => App.deck.goTo(0);
    App.deck.last = () => App.deck.goTo(App.deck.getSlides().length - 1);
})();
