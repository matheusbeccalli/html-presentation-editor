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
 * Talks to: canvas.js (sizes the iframe), thumbnails.js, ui.js (via events),
 *           shortcuts.js (key presses inside the iframe), fileio.js (drag & drop).
 */

(function () {
    'use strict';

    App.deck = {};

    let frame = null;
    let doc = null;
    let currentIndex = 0;

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

    App.deck.next = () => App.deck.goTo(currentIndex + 1);
    App.deck.previous = () => App.deck.goTo(currentIndex - 1);
    App.deck.first = () => App.deck.goTo(0);
    App.deck.last = () => App.deck.goTo(App.deck.getSlides().length - 1);

    App.deck.notesOf = function notesOf(slide) {
        const notes = slide && slide.querySelector('aside.notes');
        return notes ? notes.textContent.trim() : '';
    };
})();
