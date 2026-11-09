/*
 * notes.js - speaker notes (SPEC Phase 7).
 *
 *   <section class="slide"> … <aside class="notes">Abrir com o contexto.
 *   Depois os números.</aside></section>
 *
 * Plain text (decided in the Phase 7 Q&A): line breaks kept, no formatting.
 * The panel under the slide is a text box for the slide shown; typing writes
 * the slide's <aside class="notes"> (made at the end of the slide if it has
 * none) as one undo step per typing run (history mergeKey). Ctrl+Z / Ctrl+Y
 * in the box run the editor's undo / redo, so the slide and the box agree.
 * The deck never shows the notes (deck.js hides aside.notes); the presenter
 * view and PowerPoint export read them (Phase 8).
 *
 * Talks to: deck.js, history.js, commands.js (undo / redo).
 */

(function () {
    'use strict';

    App.notes = {};

    /* A slide's notes as plain text (the HTML's own indentation around them trimmed), or ''. */
    App.notes.textOf = function textOf(slide) {
        const aside = slide && slide.querySelector(':scope > aside.notes');
        return aside ? aside.textContent.trim() : '';
    };

    /* Set a slide's notes to `text` (plain text, never markup); they stay the last thing in the slide. */
    App.notes.write = function write(slide, text) {
        let aside = slide.querySelector(':scope > aside.notes');
        if (!aside) {
            aside = slide.ownerDocument.createElement('aside');
            aside.setAttribute('class', 'notes');
        }
        slide.appendChild(aside);
        aside.textContent = text;
    };

    let box = null;
    let typing = false;   // the box itself changed the notes: no need to show them again

    function show() {
        const slide = App.deck.getCurrentSlide();
        box.disabled = !slide;
        if (!typing) {
            box.value = App.notes.textOf(slide);
        }
    }

    function onInput() {
        const slide = App.deck.getCurrentSlide();
        if (!slide) {
            return;
        }
        const slideId = slide.getAttribute('data-slide-id');
        typing = true;
        try {
            App.history.change('Speaker notes', { slideId: slideId }, () => App.notes.write(slide, box.value),
                { mergeKey: 'notes:' + slideId });
        } finally {
            typing = false;
        }
    }

    /* Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) in the box: the editor's undo and redo, not the text box's own. */
    function onKey(event) {
        const key = event.key.toLowerCase();
        if (!(event.ctrlKey || event.metaKey) || (key !== 'z' && key !== 'y')) {
            return;
        }
        event.preventDefault();
        App.commands.run(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    }

    /* Wiring, called once from App.start(). */
    App.notes.init = function init() {
        box = document.getElementById('notes-text');
        box.addEventListener('input', onInput);
        box.addEventListener('keydown', onKey);
        ['deck-loaded', 'slide-changed', 'history-changed'].forEach((name) => App.events.on(name, show));
        show();
    };
})();
