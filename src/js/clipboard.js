/*
 * clipboard.js - text on the clipboard, in and out (SPEC Phase 3, "Paste into text").
 *
 * In: toParagraphs(html) turns the HTML another program put on the clipboard
 * into the editor's flat paragraphs (<p data-list data-level>), in a separate
 * inert document. Each source has its own way of writing lists:
 *   - Word and Outlook: <p style="mso-list:l0 level2 lfo1"> with the bullet
 *     glyph in a <span style="mso-list:Ignore"> (removed);
 *   - PowerPoint: a glyph span (mso-special-format:bullet) and only the indent
 *     to tell the level;
 *   - Copilot's chat and web pages: real nested <ul>/<ol>/<li>;
 *   - the editor itself: marked with data-deck-editor="text"; its theme fonts
 *     and colours come back as var(--…) (see App.text.copyHtml).
 * Nothing here touches the deck: text.js inserts the result (pasteAction).
 *
 * Talks to: text.js (normalize builds the paragraphs; pasteAction uses them).
 */

(function () {
    'use strict';

    App.clipboard = {};

    const WORD_LEVEL_RE = /mso-list:\s*l\d+\s+level(\d+)/i;
    const GLYPH_STYLE_RE = /mso-list:\s*ignore|mso-special-format|position:\s*absolute/i;
    const NUMBER_GLYPH_RE = /^\(?(\d+|[a-z]{1,4})[.)]$/i;

    /* A length from a style attribute in pt (in, cm, mm, px, pt), or null. */
    function points(value) {
        const match = /^(-?[\d.]+)(in|cm|mm|px|pt)$/.exec((value || '').trim());
        if (!match) {
            return null;
        }
        const factor = { in: 72, cm: 72 / 2.54, mm: 72 / 25.4, px: 0.75, pt: 1 }[match[2]];
        return parseFloat(match[1]) * factor;
    }

    /* A property from the raw style attribute (Word's mso-* properties are not in element.style). */
    function rawStyle(element, property) {
        const match = new RegExp('(?:^|;)\\s*' + property + '\\s*:\\s*([^;]+)', 'i').exec(element.getAttribute('style') || '');
        return match ? match[1].trim() : null;
    }

    /*
     * The glyph that starts a list paragraph (Word's "·", PowerPoint's "•",
     * "1." …): the outermost element around it that holds nothing else.
     */
    function glyphOf(paragraph) {
        // A glyph of this paragraph, not of a paragraph inside it.
        const marked = Array.from(paragraph.querySelectorAll('span')).find((span) =>
            GLYPH_STYLE_RE.test(span.getAttribute('style') || '') && span.closest('p, div, li') === paragraph);
        if (!marked) {
            return null;
        }
        let glyph = marked;
        while (glyph.parentElement && glyph.parentElement !== paragraph &&
            glyph.parentElement.textContent.trim() === glyph.textContent.trim()) {
            glyph = glyph.parentElement;
        }
        // It must come first in the paragraph.
        const before = paragraph.ownerDocument.createRange();
        before.setStart(paragraph, 0);
        before.setEndBefore(glyph);
        return before.toString().trim() === '' ? glyph : null;
    }

    /*
     * Word / Outlook / PowerPoint list paragraphs -> <p data-list data-level>.
     * Levels: Word writes them (mso-list … levelN); PowerPoint only indents, so
     * its distinct indents, smallest first, are levels 1, 2, 3 …
     */
    function convertGlyphParagraphs(doc) {
        const items = [];
        doc.querySelectorAll('p, div, li').forEach((paragraph) => {
            const glyph = glyphOf(paragraph);
            if (!glyph) {
                return;
            }
            const mark = glyph.textContent.replace(/[\s ]+/g, '');
            const specialHost = [glyph].concat(Array.from(glyph.querySelectorAll('[style]')))
                .find((node) => /mso-special-format/i.test(node.getAttribute('style') || ''));
            const special = specialHost ? rawStyle(specialHost, 'mso-special-format') : '';
            const isNumber = /^num/i.test(special) || NUMBER_GLYPH_RE.test(mark);
            const word = WORD_LEVEL_RE.exec(paragraph.getAttribute('style') || '');
            items.push({
                paragraph: paragraph, list: isNumber ? 'number' : 'bullet',
                number: isNumber && /^\(?\d+/.test(mark) ? parseInt(mark.replace('(', ''), 10) : null,
                level: word ? parseInt(word[1], 10) : null,
                indent: points(rawStyle(paragraph, 'margin-left')) || 0,
            });
            glyph.remove();
        });
        const indents = [];
        items.filter((item) => item.level === null).forEach((item) => {
            if (!indents.some((indent) => Math.abs(indent - item.indent) < 2)) {
                indents.push(item.indent);
            }
        });
        indents.sort((a, b) => a - b);
        const counters = [];
        items.forEach((item) => {
            const level = Math.min(5, item.level !== null ? item.level
                : indents.findIndex((indent) => Math.abs(indent - item.indent) < 2) + 1);
            item.paragraph.setAttribute('data-list', item.list);
            item.paragraph.setAttribute('data-level', String(level));
            // A number that does not follow on (a list starting at 3) becomes a start number.
            const expected = (counters[level] || 0) + 1;
            if (item.number !== null && item.number !== expected) {
                item.paragraph.setAttribute('data-start', String(item.number));
            }
            counters[level] = item.list === 'number' ? (item.number || expected) : 0;
            counters.length = level + 1;
        });
    }

    /* Headings keep their weight: bold unless they say otherwise. */
    function boldHeadings(doc) {
        doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((heading) => {
            if (!heading.style.fontWeight) {
                heading.style.fontWeight = 'bold';
            }
        });
    }

    /* Google Docs wraps everything in <b style="font-weight:normal">: that is not bold. */
    function unwrapFakeBold(doc) {
        doc.querySelectorAll('b, strong').forEach((element) => {
            if (/^(normal|[1-5]00)$/.test(element.style.fontWeight)) {
                const span = doc.createElement('span');
                span.append(...element.childNodes);
                element.replaceWith(span);
            }
        });
    }

    /* Text copied in the editor: its theme fonts and colours back as variables. */
    function restoreThemeValues(root) {
        [['data-theme-font', 'font-family'], ['data-theme-color', 'color'], ['data-theme-highlight', 'background-color']]
            .forEach(([attribute, property]) => {
                root.querySelectorAll('[' + attribute + ']').forEach((element) => {
                    const name = element.getAttribute(attribute);
                    if (/^--[a-z0-9-]+$/.test(name)) {
                        element.style.setProperty(property, 'var(' + name + ')');
                    }
                    element.removeAttribute(attribute);
                });
            });
    }

    /*
     * Clipboard HTML -> { fromEditor, holder }: holder is an element (in its
     * own inert document) whose children are the normalized flat paragraphs.
     */
    App.clipboard.toParagraphs = function toParagraphs(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const marked = doc.querySelector('[data-deck-editor="text"]');
        let root = doc.body;
        if (marked) {
            restoreThemeValues(marked);
            root = marked;
        } else {
            convertGlyphParagraphs(doc);
            boldHeadings(doc);
            unwrapFakeBold(doc);
        }
        const holder = doc.createElement('div');
        holder.append(...root.childNodes);
        App.text.normalize(holder);
        return { fromEditor: !!marked, holder: holder };
    };
})();
