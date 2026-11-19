/*
 * serialize.js - turns the live deck into the HTML text that is saved (SPEC 3.6).
 *
 * The editor marks everything it adds to the deck with one naming rule, so
 * it can all be stripped on save without a list of special cases:
 *   - elements with the attribute  data-editor-only        (editor CSS, overlays)
 *   - attributes starting with     data-editor-            (current slide, temp ids)
 *   - classes starting with        editor-                 (selection, hover)
 *   - the attribute contenteditable                        (text editing, Phase 3)
 *
 * Then the small player (src/player/) is added, so the saved file presents on
 * its own in any browser, and prints one slide per page.
 *
 * Works on a copy: the live deck in the canvas is never touched.
 *
 * Talks to: fileio.js (calls toHtml when saving), deck.js (provides the document).
 */

(function () {
    'use strict';

    App.serialize = {};

    const EDITOR_ATTRIBUTE_PREFIX = 'data-editor-';
    const EDITOR_CLASS_PREFIX = 'editor-';
    const EDITOR_ONLY_ATTRIBUTES = ['contenteditable', 'spellcheck'];   // spellcheck: set while editing text

    function stripEditorMarks(root) {
        root.querySelectorAll('[data-editor-only]').forEach((node) => node.remove());

        [root].concat(Array.from(root.querySelectorAll('*'))).forEach((element) => {
            Array.from(element.attributes).forEach((attribute) => {
                if (attribute.name.startsWith(EDITOR_ATTRIBUTE_PREFIX) ||
                    EDITOR_ONLY_ATTRIBUTES.indexOf(attribute.name) !== -1) {
                    element.removeAttribute(attribute.name);
                }
            });
            if (element.hasAttribute('class')) {
                const kept = Array.from(element.classList).filter((name) => !name.startsWith(EDITOR_CLASS_PREFIX));
                if (kept.length === 0) {
                    element.removeAttribute('class');
                } else if (kept.length !== element.classList.length) {
                    element.setAttribute('class', kept.join(' '));
                }
            }
        });
    }

    // Whitespace left at the end of <head>/<body> would pile up on every save.
    function trimTrailingWhitespace(parent) {
        while (parent.lastChild && parent.lastChild.nodeType === Node.TEXT_NODE &&
               parent.lastChild.textContent.trim() === '') {
            parent.lastChild.remove();
        }
    }

    function ensureMetaTags(doc, head) {
        let charset = head.querySelector('meta[charset]');
        if (!charset) {
            charset = doc.createElement('meta');
            charset.setAttribute('charset', 'utf-8');
        }
        head.prepend(charset);   // the charset must come first

        let format = head.querySelector('meta[name="deck-format"]');
        if (!format) {
            format = doc.createElement('meta');
            format.setAttribute('name', 'deck-format');
            charset.after(format);
        }
        format.setAttribute('content', String(App.DECK_FORMAT));
    }

    /*
     * Return a cleaned copy of the deck's <html> element.
     * Exposed for tests; normal callers use toHtml.
     */
    App.serialize.cleanCopy = function cleanCopy(doc, options) {
        const root = doc.documentElement.cloneNode(true);
        stripEditorMarks(root);
        root.querySelectorAll('[data-deck-player]').forEach((node) => node.remove());
        // Review comments (Phase 9) stay only in the deck file itself (Save, AutoSave, drafts ask for them);
        // everything else made from this copy - the show, print, pictures, PowerPoint, a clean copy - leaves
        // them out, so a new export path cannot leak them by forgetting to.
        if (!(options && options.keepComments)) {
            App.comments.removeAll(root);
        }
        if (options && options.cleanCopy) {
            // File > Save a Clean Copy (Phase 8): a copy to send. It is a deck of its own (no deck id: opened
            // later, it is never taken for the original or offered the original's recovery drafts), and the
            // hidden slides go when asked. Its review comments are already gone (above).
            root.querySelectorAll('meta[name="deck-id"]').forEach((meta) => meta.remove());
            if (options.removeHidden) {
                root.querySelectorAll('section.slide[data-hidden="true"]').forEach((slide) => slide.remove());
            }
            // Elements hidden with the Selection Pane's eye (Phase 10) are still in the file; a copy to send
            // drops them when asked, so nobody can show them again from it.
            if (options.removeHiddenElements) {
                hiddenElementsIn(root).forEach((element) => element.remove());
            }
        }
        App.master.sync(root);   // the slide master's copies, numbered as the slides stand now
        // Text is saved in the text model, even if the user is still typing (SPEC: normalize before save).
        root.querySelectorAll('.el[data-type="text"]').forEach((element) => App.text.normalize(element));
        root.querySelectorAll(App.tables.CELL_SELECTOR).forEach((cell) => App.text.normalizeCell(cell));
        root.querySelectorAll(App.shapes.TEXT_SELECTOR).forEach((text) => App.text.normalizeCell(text));
        return root;
    };

    /* Elements hidden in the Selection Pane, outermost only (a hidden group's hidden parts go with it). */
    function hiddenElementsIn(root) {
        return Array.from(root.querySelectorAll('.el[data-hidden="true"]'))
            .filter((element) => !element.parentElement.closest('.el[data-hidden="true"]'));
    }

    /* How many elements of `root` are hidden in the Selection Pane (Save a Clean Copy's tick). */
    App.serialize.hiddenElementCount = function hiddenElementCount(root) {
        return hiddenElementsIn(root).length;
    };

    /*
     * The complete file text to save.
     * player = { playerJs, playerCss } - the contents of src/player/*.
     * options = { cleanCopy, removeHidden, removeHiddenElements } for File > Save a Clean Copy (cleanCopy above).
     */
    App.serialize.toHtml = function toHtml(doc, player, options) {
        const root = App.serialize.cleanCopy(doc, options);
        const head = root.querySelector('head');
        const body = root.querySelector('body');

        ensureMetaTags(doc, head);

        trimTrailingWhitespace(head);
        const style = doc.createElement('style');
        style.setAttribute('data-deck-player', '');
        style.textContent = player.playerCss;
        head.appendChild(style);

        trimTrailingWhitespace(body);
        const script = doc.createElement('script');
        script.setAttribute('data-deck-player', '');
        script.textContent = player.playerJs;
        body.appendChild(script);

        return '<!DOCTYPE html>\n' + root.outerHTML;
    };
})();
