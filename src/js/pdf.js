/*
 * pdf.js - PDF through the browser's print window (Phase 8, SPEC 7.2).
 *
 * Export > PDF (or Ctrl+P, File > Print / PDF) asks which slides: all, the
 * current one, or a range such as "1-3, 5", and whether hidden slides are
 * included. It then prints a separate document holding only those slides: a
 * clean copy of the deck (what Save writes) with the saved deck's own print
 * styles (player.css: a 13.333 × 7.5 in page with no margin, one slide per page,
 * backgrounds and fills printed exactly). So the editor's ribbon, panels and
 * selection never print, and the PDF looks like the slides on screen: text,
 * charts and shapes stay sharp (vector) in the PDF.
 *
 * That document goes into a hidden frame that is allowed to open the print window
 * (sandbox "allow-modals") but runs no scripts; the frame prints itself. The user
 * picks "Save as PDF" there: a one-line hint says so the first time.
 *
 * Talks to: serialize.js (the clean copy), deck.js, slides.js (hidden slides),
 * dialogs.js, settings.js (the hint shown once), commands.js (exportPdf).
 */

(function () {
    'use strict';

    App.pdf = {};

    /* ---------- Pure parts ---------- */

    /*
     * "1-3, 5" → { indexes: [0, 1, 2, 4] } (0-based, sorted, once each), or { error: text }.
     * count = the number of slides in the deck.
     */
    App.pdf.parseRange = function parseRange(text, count) {
        const parts = String(text || '').split(/[,;]/).map((part) => part.trim()).filter(Boolean);
        if (parts.length === 0) {
            return { error: 'Type the slides to print, e.g. 1-3, 5.' };
        }
        const chosen = new Set();
        for (const part of parts) {
            const match = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(part);
            if (!match) {
                return { error: '"' + part + '" is not a slide number or a range like 1-3.' };
            }
            const first = parseInt(match[1], 10);
            const last = match[2] === undefined ? first : parseInt(match[2], 10);
            for (const number of [first, last]) {
                if (number < 1 || number > count) {
                    return { error: 'There is no slide ' + number + ': the deck has ' + count + ' slides.' };
                }
            }
            for (let number = Math.min(first, last); number <= Math.max(first, last); number++) {
                chosen.add(number - 1);
            }
        }
        return { indexes: Array.from(chosen).sort((a, b) => a - b) };
    };

    /*
     * The slides to print (0-based). options = { mode: 'all' | 'current' | 'range',
     * current, range (indexes), hidden (one true/false per slide), includeHidden }.
     * The current slide prints even when hidden: the user asked for that one.
     */
    App.pdf.pickSlides = function pickSlides(options) {
        if (options.mode === 'current') {
            return [options.current];
        }
        const candidates = options.mode === 'range' ? options.range : options.hidden.map((_, i) => i);
        return candidates.filter((i) => options.includeHidden || !options.hidden[i]);
    };

    /*
     * The text of the document to print: the deck's clean copy with only the slides
     * `indexes`, none of them hidden, titled `title` (the PDF's suggested name),
     * with `printCss` (the player's styles: page size, one slide per page).
     */
    App.pdf.printDocument = function printDocument(deckDoc, indexes, title, printCss) {
        const root = App.serialize.cleanCopy(deckDoc);   // slide numbers are counted before slides are left out
        root.querySelectorAll('section.slide').forEach((slide, i) => {
            if (indexes.indexOf(i) === -1) {
                slide.remove();
            } else {
                slide.removeAttribute('data-hidden');
                // A slide link (#slide-<id>, Phase 10) finds its page in the PDF by this id.
                slide.setAttribute('id', 'slide-' + slide.getAttribute('data-slide-id'));
            }
        });
        const head = root.querySelector('head');
        head.querySelectorAll('title').forEach((node) => node.remove());
        const titleNode = deckDoc.createElement('title');
        titleNode.textContent = title;
        head.insertBefore(titleNode, head.firstChild);
        const style = deckDoc.createElement('style');
        style.textContent = printCss;
        head.appendChild(style);
        return '<!DOCTYPE html>\n' + root.outerHTML;
    };

    /* ---------- The dialog and the printing ---------- */

    const el = (...args) => App.util.el(...args);

    function deckTitle() {
        const name = App.state.fileName || 'Presentation';
        return name.replace(/\.html?$/i, '');
    }

    /* Ask which slides; resolves { mode, range, includeHidden } or null (cancelled). */
    async function askSlides(count, previous, error) {
        const choice = (value, label, checked) => el('label', { class: 'pdf-choice' }, [
            el('input', { type: 'radio', name: 'pdf-slides', value: value, checked: checked }), ' ' + label]);
        const rangeBox = el('input', { type: 'text', id: 'pdf-range', placeholder: 'e.g. 1-3, 5', 'aria-label': 'Slides to print',
            value: previous.rangeText || '' });
        const hiddenBox = el('input', { type: 'checkbox', id: 'pdf-include-hidden', checked: !!previous.includeHidden });
        const body = el('div', { class: 'pdf-dialog' }, [
            choice('all', 'All slides', previous.mode === 'all'),
            choice('current', 'Current slide', previous.mode === 'current'),
            el('label', { class: 'pdf-choice' }, [
                el('input', { type: 'radio', name: 'pdf-slides', value: 'range', checked: previous.mode === 'range' }),
                ' Slides: ', rangeBox]),
            el('label', { class: 'pdf-choice' }, [hiddenBox, ' Include hidden slides']),
        ]);
        rangeBox.addEventListener('focus', () => {
            body.querySelector('input[value="range"]').checked = true;
        });
        if (error) {
            body.appendChild(el('p', { class: 'pdf-error', role: 'alert' }, [error]));
        }
        if (!App.settings.get().pdfHintShown) {
            body.appendChild(el('p', { class: 'pdf-hint' }, [
                'In the print window, set Destination to "Save as PDF", then click Save.']));
        }
        const result = await App.dialogs.show({
            title: 'Save as PDF (' + count + ' slides)',
            body: body,
            buttons: [{ label: 'Print…', value: true, primary: true }, { label: 'Cancel', value: false }],
        });
        if (!result) {
            return null;
        }
        return {
            mode: body.querySelector('input[name="pdf-slides"]:checked').value,
            rangeText: rangeBox.value,
            includeHidden: hiddenBox.checked,
        };
    }

    /*
     * Print the document in a hidden frame. Kept apart so the tests can see the
     * document instead of a print window they cannot close.
     */
    App.pdf.printWindow = function printWindow(frameWindow) {
        frameWindow.print();
    };

    function printHtml(html) {
        document.querySelectorAll('iframe.pdf-print-frame').forEach((old) => old.remove());
        const frame = el('iframe', { class: 'pdf-print-frame', title: 'Print', 'aria-hidden': 'true', tabindex: '-1',
            sandbox: 'allow-same-origin allow-modals' });
        frame.srcdoc = html;   // before it is in the page, so its first load is this document
        frame.addEventListener('load', () => {
            if (!frame.contentDocument.querySelector('section.slide')) {
                return;
            }
            // print() returns once the print window is closed; the frame stays until the next print.
            App.pdf.printWindow(frame.contentWindow);
        });
        document.body.appendChild(frame);
    }

    let lastChoice = { mode: 'all', rangeText: '', includeHidden: false };

    /* Export > PDF / Ctrl+P. */
    App.pdf.open = async function open() {
        const deckDoc = App.deck.getDocument();
        if (!deckDoc) {
            return;
        }
        const slides = App.deck.getSlides();
        let error = null;
        let indexes = null;
        while (!indexes) {
            const answer = await askSlides(slides.length, lastChoice, error);
            if (!answer) {
                return;
            }
            lastChoice = answer;
            let range = null;
            if (answer.mode === 'range') {
                const parsed = App.pdf.parseRange(answer.rangeText, slides.length);
                if (parsed.error) {
                    error = parsed.error;
                    continue;
                }
                range = parsed.indexes;
            }
            indexes = App.pdf.pickSlides({
                mode: answer.mode, range: range, current: App.deck.getCurrentIndex(),
                hidden: slides.map((slide) => App.slides.isHidden(slide)), includeHidden: answer.includeHidden,
            });
            if (indexes.length === 0) {
                error = 'Every slide chosen is hidden. Tick "Include hidden slides" to print them.';
                indexes = null;
            }
        }
        const css = document.getElementById('deck-player-css').textContent;
        printHtml(App.pdf.printDocument(deckDoc, indexes, deckTitle(), css));
        App.ui.setStatus('Printing ' + indexes.length + (indexes.length === 1 ? ' slide' : ' slides'));
        if (!App.settings.get().pdfHintShown) {
            App.settings.update({ pdfHintShown: true });
        }
    };
})();
