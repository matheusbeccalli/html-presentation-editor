/*
 * snapshot.js - a slide as a picture (Phase 8, SPEC 7.3), drawn by the browser itself.
 *
 * SPEC 7.3 named the html2canvas library; as decided in the Phase 8 Q&A we do
 * without it. html2canvas re-draws a page with its own code, so bullets (CSS
 * counters), scaled text and SVG charts can come out differently. Instead, the
 * slide (a clean copy, with the deck's own styles) is wrapped in an SVG
 * <foreignObject> - an SVG picture that holds a piece of web page - and the
 * browser draws that picture into a canvas at 2× size. What comes out is what the
 * browser draws on screen.
 *
 * The picture must be a data: URL: a blob: URL would mark the canvas as
 * "tainted" and the browser would refuse to hand over its pixels.
 *
 * Used by Export > PNG (current slide / all slides as a ZIP: JSZip, from the
 * PptxGenJS bundle), Copy Slide as
 * Picture, and the PowerPoint export for anything it cannot rebuild natively.
 *
 * Talks to: serialize.js (the clean copy), deck.js, slides.js (hidden slides), fileio.js
 * (downloads), ui.js (progress), commands.js (exportPng, exportPngAll, copySlideImage).
 */

(function () {
    'use strict';

    App.snapshot = {};

    const SLIDE_WIDTH = 1280;
    const SLIDE_HEIGHT = 720;

    // The slide alone, at the top-left corner, as it shows when presenting: whatever the deck's own
    // CSS does for its slides on a page (margins, a frame, hidden ones), notes never show.
    const ALONE_CSS =
        'html, body { margin: 0 !important; padding: 0 !important; background: transparent !important; }' +
        'section.slide { display: block !important; position: relative !important; left: 0 !important; top: 0 !important;' +
        ' margin: 0 !important; transform: none !important; opacity: 1 !important; visibility: visible !important; }' +
        'aside.notes, .master { display: none !important; }';

    /* 'contract-deck', slide 3 of 12 → 'contract-deck-slide-03.png'. */
    App.snapshot.fileName = function fileName(deckName, number, count) {
        const width = Math.max(2, String(count).length);
        return deckName + '-slide-' + String(number).padStart(width, '0') + '.png';
    };

    /*
     * The SVG text that draws slide `index` of `root` (a clean copy: serialize.cleanCopy), 1280 × 720.
     * extraCss: more rules for the picture (partPng: show only one part of the slide).
     */
    App.snapshot.slideSvg = function slideSvg(root, index, extraCss) {
        const slide = root.querySelectorAll('section.slide')[index];
        const page = document.implementation.createHTMLDocument('');
        const html = page.documentElement;
        html.setAttribute('lang', root.getAttribute('lang') || 'en');
        root.querySelectorAll('head style').forEach((style) => page.head.appendChild(page.importNode(style, true)));
        const alone = page.createElement('style');
        alone.textContent = ALONE_CSS + (extraCss || '');
        page.head.appendChild(alone);
        const copy = page.importNode(slide, true);
        copy.querySelectorAll('aside.notes').forEach((notes) => notes.remove());
        page.body.appendChild(copy);
        // XMLSerializer writes XHTML (every tag closed, the SVG inside charts with its own namespace).
        const markup = new XMLSerializer().serializeToString(html);
        return '<svg xmlns="http://www.w3.org/2000/svg" width="' + SLIDE_WIDTH + '" height="' + SLIDE_HEIGHT + '">' +
            '<foreignObject x="0" y="0" width="' + SLIDE_WIDTH + '" height="' + SLIDE_HEIGHT + '">' + markup +
            '</foreignObject></svg>';
    };

    /*
     * Draw a slide's SVG text into a new canvas, `scale` times the slide's size (2 = 2560 × 1440).
     * The browser draws the picture at that size, so text stays sharp. Resolves the canvas.
     */
    App.snapshot.toCanvas = function toCanvas(svg, scale, transparent) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = SLIDE_WIDTH * scale;
                canvas.height = SLIDE_HEIGHT * scale;
                const context = canvas.getContext('2d');
                context.scale(scale, scale);
                if (!transparent) {
                    context.fillStyle = '#ffffff';   // a slide without its own background is white, as on screen
                    context.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);
                }
                context.drawImage(image, 0, 0);
                resolve(canvas);
            };
            image.onerror = () => reject(new Error('The browser could not draw this slide as a picture.'));
            image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        });
    };

    function canvasToPng(canvas) {
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The picture could not be made.'))), 'image/png');
        });
    }

    /*
     * Pictures of the slides `indexes` of the deck shown, as PNG blobs (in that order).
     * One clean copy serves them all.
     */
    App.snapshot.slidePngs = async function slidePngs(indexes, scale, onProgress) {
        const root = App.serialize.cleanCopy(App.deck.getDocument());
        const pictures = [];
        for (const index of indexes) {
            if (onProgress) {
                onProgress(pictures.length + 1, indexes.length);
            }
            const canvas = await App.snapshot.toCanvas(App.snapshot.slideSvg(root, index), scale);
            pictures.push(await canvasToPng(canvas));
        }
        return pictures;
    };

    /*
     * Export > PNG of All Slides: every slide not hidden, 2×, in one ZIP file
     * (deck-slides.zip holding deck-slide-01.png …), made with the JSZip that comes
     * inside PptxGenJS's bundle (vendor/README.md). PNGs are already compressed, so
     * they are stored as they are.
     */
    App.snapshot.exportAll = async function exportAll() {
        const slides = App.deck.getSlides();
        const indexes = slides.map((slide, i) => i).filter((i) => !App.slides.isHidden(slides[i]));
        try {
            const pictures = await App.snapshot.slidePngs(indexes, 2, (done, total) =>
                App.ui.setBusy('Drawing slide ' + done + ' of ' + total + '…'));
            App.ui.setBusy('Making the ZIP file…');
            const zip = new JSZip();
            indexes.forEach((index, i) => {
                zip.file(App.snapshot.fileName(deckName(), index + 1, slides.length), pictures[i]);
            });
            const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
            const name = deckName() + '-slides.zip';
            App.fileio.downloadBlob(name, blob);
            App.ui.setStatus('Saved ' + name + ' (' + indexes.length + ' slides) to your Downloads folder');
        } finally {
            App.ui.setBusy(null);
        }
    };

    /*
     * A picture of one part of slide `index` (the PowerPoint export, for what it cannot
     * rebuild natively): only the slide's child matching `selector` is drawn, on a
     * transparent background, cut to `box` (slide px). selector null: the slide's
     * background alone. Resolves { data: 'image/png;base64,…' (as PptxGenJS takes it), box:
     * the part of `box` inside the slide, where the picture goes }.
     */
    App.snapshot.partPng = async function partPng(root, index, selector, box, scale) {
        const css = selector === null
            ? 'section.slide > * { visibility: hidden !important; }'
            // Hidden: everything that is not the part, not inside it and not around it (a group holding it).
            : 'section.slide { background: none transparent !important; }' +
              'section.slide *:not(' + selector + '):not(:has(' + selector + ')):not(' + selector + ' *) { visibility: hidden !important; }';
        const canvas = await App.snapshot.toCanvas(App.snapshot.slideSvg(root, index, css), scale, selector !== null);
        const left = Math.max(0, Math.floor(box.left * scale));
        const top = Math.max(0, Math.floor(box.top * scale));
        const right = Math.min(canvas.width, Math.ceil((box.left + box.width) * scale));
        const bottom = Math.min(canvas.height, Math.ceil((box.top + box.height) * scale));
        const piece = document.createElement('canvas');
        piece.width = Math.max(1, right - left);
        piece.height = Math.max(1, bottom - top);
        piece.getContext('2d').drawImage(canvas, left, top, piece.width, piece.height, 0, 0, piece.width, piece.height);
        return {
            data: piece.toDataURL('image/png').replace(/^data:/, ''),
            box: { left: left / scale, top: top / scale, width: piece.width / scale, height: piece.height / scale },
        };
    };

    function deckName() {
        return (App.state.fileName || 'Presentation').replace(/\.html?$/i, '');
    }

    /* Export > PNG > Current Slide: a 2× picture of the slide shown, downloaded. */
    App.snapshot.exportCurrent = async function exportCurrent() {
        const index = App.deck.getCurrentIndex();
        const [png] = await App.snapshot.slidePngs([index], 2);
        const name = App.snapshot.fileName(deckName(), index + 1, App.deck.getSlides().length);
        App.fileio.downloadBlob(name, png);
        App.ui.setStatus('Saved ' + name + ' (your Downloads folder)');
    };

    /*
     * Copy Slide as Picture: the slide shown, as a 2× PNG on the clipboard (paste into
     * Outlook or Teams). Where the browser refuses, the PNG is downloaded instead.
     */
    App.snapshot.copyCurrent = async function copyCurrent() {
        const index = App.deck.getCurrentIndex();
        // The clipboard is asked at once, with a promise of the picture: browsers only allow a
        // clipboard write straight from the click or key press.
        const picture = App.snapshot.slidePngs([index], 2).then((pictures) => pictures[0]);
        try {
            if (!navigator.clipboard || !window.ClipboardItem) {
                throw new Error('no clipboard');
            }
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': picture })]);
            App.ui.setStatus('Slide ' + (index + 1) + ' copied as a picture: paste it into Outlook or Teams');
        } catch (error) {
            const name = App.snapshot.fileName(deckName(), index + 1, App.deck.getSlides().length);
            App.fileio.downloadBlob(name, await picture);
            App.ui.setStatus('The browser did not allow copying a picture: saved ' + name + ' to your Downloads folder instead');
        }
    };
})();
