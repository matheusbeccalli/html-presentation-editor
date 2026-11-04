/*
 * images.js - pictures on slides (SPEC Phase 5).
 *
 *   <img class="el" data-type="image" data-id="e2" alt="" style="left; top; width; height; z-index"
 *        src="data:image/png;base64,…">
 *
 * Every picture lives inside the deck as a data: URI (SPEC 2.2), so pictures
 * are made small on the way in (compress):
 *   - the longest side is at most 1920 px;
 *   - a picture with transparency stays PNG;
 *   - otherwise both PNG and JPEG (quality 0.85) are made and the smaller one
 *     is kept: photos become JPEG, screenshots and flat logos usually stay PNG
 *     (sharp text); a file already smaller than both is kept as it is;
 *   - SVG is kept as it is (it is sharp at any size; scripts never run in <img>).
 * A new picture is centred on the slide at its own size, or smaller to fit
 * inside the margins (placeRect).
 *
 * Talks to: elements.js (ids, on top of the slide), history.js, selection.js,
 *           deck.js, ui.js (messages).
 */

(function () {
    'use strict';

    App.images = {};

    App.images.MAX_SIDE = 1920;
    const JPEG_QUALITY = 0.85;
    const SLIDE = { width: 1280, height: 720 };
    const MARGIN = 64;   // px around a picture too big for the slide, like the title's left edge

    function round2(value) {
        return Math.round(value * 100) / 100;
    }

    // ---------------------------------------------------------------
    // Sizes (pure)
    // ---------------------------------------------------------------

    /* width x height made smaller, keeping its proportions, so its longest side is at most `max`. */
    App.images.fitSize = function fitSize(width, height, max) {
        const scale = Math.min(1, max / Math.max(width, height));
        return { width: Math.round(width * scale), height: Math.round(height * scale) };
    };

    /* Where a new picture of width x height px goes: centred, at its size, or smaller to fit inside the margins. */
    App.images.placeRect = function placeRect(width, height) {
        const scale = Math.min(1, (SLIDE.width - 2 * MARGIN) / width, (SLIDE.height - 2 * MARGIN) / height);
        const shown = { width: width * scale, height: height * scale };
        return {
            left: round2((SLIDE.width - shown.width) / 2), top: round2((SLIDE.height - shown.height) / 2),
            width: round2(shown.width), height: round2(shown.height),
        };
    };

    // ---------------------------------------------------------------
    // Compression
    // ---------------------------------------------------------------

    App.images.dataUrlOf = function dataUrlOf(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    };

    function loadImage(blob) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const image = new Image();
            image.onload = () => {
                URL.revokeObjectURL(url);
                resolve(image);
            };
            image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('This picture cannot be shown by the browser. Save it as PNG or JPEG and try again.'));
            };
            image.src = url;
        });
    }

    function hasTransparency(context, width, height) {
        const pixels = context.getImageData(0, 0, width, height).data;
        for (let i = 3; i < pixels.length; i += 4) {
            if (pixels[i] < 255) {
                return true;
            }
        }
        return false;
    }

    /*
     * A picture file (a Blob) made ready for the deck: { src (data: URI), width,
     * height (its pixels), type }. Rejects with a plain message if the browser
     * cannot show it.
     */
    App.images.compress = async function compress(blob) {
        const image = await loadImage(blob);
        const original = { width: image.naturalWidth, height: image.naturalHeight };
        if (blob.type === 'image/svg+xml') {
            return { src: await App.images.dataUrlOf(blob), width: original.width, height: original.height, type: blob.type };
        }
        const size = App.images.fitSize(original.width, original.height, App.images.MAX_SIDE);
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, size.width, size.height);
        const candidates = [{ src: canvas.toDataURL('image/png'), type: 'image/png' }];
        if (!hasTransparency(context, size.width, size.height)) {
            candidates.push({ src: canvas.toDataURL('image/jpeg', JPEG_QUALITY), type: 'image/jpeg' });
        }
        const unchanged = size.width === original.width && size.height === original.height;
        if (unchanged && (blob.type === 'image/png' || blob.type === 'image/jpeg')) {
            candidates.push({ src: await App.images.dataUrlOf(blob), type: blob.type });
        }
        const smallest = candidates.reduce((best, next) => (next.src.length < best.src.length ? next : best));
        return { src: smallest.src, width: size.width, height: size.height, type: smallest.type };
    };

    // ---------------------------------------------------------------
    // The picture element
    // ---------------------------------------------------------------

    /* A new picture element (not yet on a slide) for `picture` (from compress) at `rect`, with id `id`. */
    App.images.createImage = function createImage(doc, picture, rect, id) {
        const element = doc.createElement('img');
        element.setAttribute('class', 'el');
        element.setAttribute('data-type', 'image');
        element.setAttribute('data-id', id);
        element.setAttribute('alt', '');
        // The long data: URI last, so the saved HTML stays readable.
        element.setAttribute('style', ['left', 'top', 'width', 'height'].map((side) => side + ': ' + rect[side] + 'px;').join(' '));
        element.setAttribute('src', picture.src);
        return element;
    };

    /*
     * Put pictures from files on the current slide: one undo step, the last one
     * selected. Several files are stepped 10 px aside each, like pasting.
     * Files that are not pictures, or cannot be shown, are named in the status bar.
     */
    App.images.insertFiles = async function insertFiles(files) {
        const slide = App.deck.getCurrentSlide();
        const pictures = [];
        const refused = [];
        for (const file of Array.from(files)) {
            try {
                pictures.push(await App.images.compress(file));
            } catch (error) {
                refused.push(file.name);
            }
        }
        if (!slide || !slide.isConnected || pictures.length === 0) {
            if (refused.length > 0) {
                App.ui.setStatus('Not a picture the browser can show: ' + refused.join(', '));
            }
            return [];
        }
        const doc = slide.ownerDocument;
        const added = [];
        App.history.change(pictures.length > 1 ? 'Insert pictures' : 'Insert picture',
            { slideId: slide.getAttribute('data-slide-id') }, () => {
                pictures.forEach((picture, index) => {
                    const rect = App.images.placeRect(picture.width, picture.height);
                    rect.left = round2(rect.left + index * 10);
                    rect.top = round2(rect.top + index * 10);
                    const element = App.images.createImage(doc, picture, rect, App.elements.freshId(doc));
                    App.elements.addOnTop(slide, element);
                    added.push(element);
                });
            });
        App.selection.select(added[added.length - 1]);
        App.ui.setStatus(refused.length > 0 ? 'Not a picture the browser can show: ' + refused.join(', ') : '');
        return added;
    };

    /* Insert > Pictures: the file picker, then the pictures chosen. */
    App.images.choose = function choose() {
        const input = document.getElementById('picture-input');
        input.value = '';
        input.click();
    };

    /* Wiring, called once from App.start(). */
    App.images.init = function init() {
        document.getElementById('picture-input').addEventListener('change', (event) => {
            if (event.target.files.length > 0) {
                App.text.exitEdit({ select: false });
                App.images.insertFiles(event.target.files);
            }
        });
    };
})();
