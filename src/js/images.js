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
 * Picture Format tab (shown while a picture is selected): Change Picture (the
 * new picture fits inside the old box, centred, keeping its proportions; same
 * id and stacking order) and Reset size (the size it came in with, around the
 * same centre, kept inside the slide).
 *
 * Three ways in, all through insertFiles: Insert > Pictures (the file picker),
 * a picture file dropped on the window (fileio.js) and Ctrl+V of a picture on
 * the clipboard, e.g. a screenshot or an Excel chart (elements.js; text.js
 * while typing).
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

    /* A picture of width x height px fitted inside `box`, centred, keeping its proportions (Change Picture). */
    App.images.fitInside = function fitInside(box, width, height) {
        const scale = Math.min(box.width / width, box.height / height);
        const shown = { width: width * scale, height: height * scale };
        return {
            left: round2(box.left + (box.width - shown.width) / 2), top: round2(box.top + (box.height - shown.height) / 2),
            width: round2(shown.width), height: round2(shown.height),
        };
    };

    /* Reset size: the size a picture of width x height pixels came in with (placeRect), around the centre of `rect`, inside the slide. */
    App.images.resetRect = function resetRect(rect, width, height) {
        const size = App.images.placeRect(width, height);
        const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        const inside = (value, room) => Math.min(Math.max(value, 0), room);
        return {
            left: round2(inside(centre.x - size.width / 2, SLIDE.width - size.width)),
            top: round2(inside(centre.y - size.height / 2, SLIDE.height - size.height)),
            width: size.width, height: size.height,
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

    function hasTransparency(pixels) {
        for (let i = 3; i < pixels.length; i += 4) {
            if (pixels[i] < 255) {
                return true;
            }
        }
        return false;
    }

    /*
     * A graphic (a logo, a screenshot, a chart from Excel) rather than a photo:
     * few different colours. Counted on a grid of at most 256 x 256 of its
     * pixels (`pixels`: RGBA, width x height): a graphic has under 5% different
     * colours there (at least 256 allowed, for anti-aliased edges); a photo has
     * far more. A graphic stays PNG: JPEG smudges sharp edges and text.
     */
    App.images.isGraphic = function isGraphic(pixels, width, height) {
        const stepX = Math.max(1, Math.ceil(width / 256));
        const stepY = Math.max(1, Math.ceil(height / 256));
        const colours = new Set();
        let sampled = 0;
        for (let y = 0; y < height; y += stepY) {
            for (let x = 0; x < width; x += stepX) {
                const at = (y * width + x) * 4;
                colours.add((pixels[at] << 16) | (pixels[at + 1] << 8) | pixels[at + 2]);
                sampled += 1;
            }
        }
        return colours.size <= Math.max(256, sampled * 0.05);
    };

    /* PNG for a graphic or a transparent picture; otherwise the smaller of PNG and JPEG. */
    App.images.pickEncoding = function pickEncoding(options) {
        if (options.graphic || options.transparent || !options.jpeg) {
            return options.png;
        }
        return options.jpeg.src.length < options.png.src.length ? options.jpeg : options.png;
    };

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
        canvas.getContext('2d').drawImage(image, 0, 0, size.width, size.height);
        const encoded = App.images.encode(canvas);
        const unchanged = size.width === original.width && size.height === original.height;
        let smallest = encoded;
        if (unchanged && (blob.type === 'image/png' || blob.type === 'image/jpeg')) {
            const asIs = await App.images.dataUrlOf(blob);
            if (asIs.length < encoded.src.length) {
                smallest = { src: asIs, type: blob.type };
            }
        }
        return { src: smallest.src, width: size.width, height: size.height, type: smallest.type };
    };

    /* A canvas as a data: URI: PNG for a graphic or a transparent picture, else the smaller of PNG and JPEG 0.85. { src, type } */
    App.images.encode = function encode(canvas) {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        const transparent = hasTransparency(pixels);
        const graphic = !transparent && App.images.isGraphic(pixels, canvas.width, canvas.height);
        return App.images.pickEncoding({
            png: { src: canvas.toDataURL('image/png'), type: 'image/png' },
            jpeg: transparent || graphic ? null : { src: canvas.toDataURL('image/jpeg', JPEG_QUALITY), type: 'image/jpeg' },
            graphic: graphic, transparent: transparent,
        });
    };

    // ---------------------------------------------------------------
    // Pictures from a drop or a paste
    // ---------------------------------------------------------------

    function isPicture(type) {
        return /^image\//.test(type || '');
    }

    /*
     * A drag over the window carries pictures for the slide (true) or a deck to
     * open (false). During the drag only the kinds and types are known, not the
     * names: { kind: 'file' | 'string', type }. An .html file among them wins.
     */
    App.images.isPictureDrop = function isPictureDrop(items) {
        const files = Array.from(items || []).filter((item) => item.kind === 'file');
        return files.some((item) => isPicture(item.type)) && !files.some((item) => item.type === 'text/html');
    };

    /* The picture files of a paste or a drop (a DataTransfer), or []. */
    App.images.picturesIn = function picturesIn(transfer) {
        return transfer ? Array.from(transfer.files || []).filter((file) => isPicture(file.type)) : [];
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
     * `verb` names the undo step: 'Insert' (the default) or 'Paste'.
     */
    App.images.insertFiles = async function insertFiles(files, verb) {
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
        App.history.change((verb || 'Insert') + (pictures.length > 1 ? ' pictures' : ' picture'),
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

    // ---------------------------------------------------------------
    // Picture Format
    // ---------------------------------------------------------------

    App.images.isPictureSelected = function isPictureSelected() {
        const element = App.selection.getElement();
        return !!element && element.getAttribute('data-type') === 'image';
    };

    function slideScopeOf(element) {
        return { slideId: element.closest('section.slide').getAttribute('data-slide-id') };
    }

    /* Change Picture: `file` in place of the picture `element`, fitted inside its box; one undo step. */
    App.images.replace = async function replace(element, file) {
        let picture;
        try {
            picture = await App.images.compress(file);
        } catch (error) {
            App.ui.setStatus('Not a picture the browser can show: ' + file.name);
            return;
        }
        if (!element.isConnected) {
            return;
        }
        App.history.change('Change picture', slideScopeOf(element), () => {
            App.transform.writeRect(element, App.images.fitInside(App.transform.readRect(element), picture.width, picture.height));
            element.setAttribute('src', picture.src);
        });
        App.ui.setStatus('');
    };

    /* Reset size of the selected picture (its pixels as they are now stored). */
    App.images.resetSize = function resetSize() {
        const element = App.selection.getElement();
        if (!App.images.isPictureSelected() || !element.naturalWidth) {
            return;
        }
        App.history.change('Reset size', slideScopeOf(element), () => {
            App.transform.writeRect(element, App.images.resetRect(App.transform.readRect(element), element.naturalWidth, element.naturalHeight));
        });
    };

    // ---------------------------------------------------------------
    // The file picker
    // ---------------------------------------------------------------

    let replacing = null;   // the picture Change Picture works on, while its file picker is open

    /* Insert > Pictures: the file picker, then the pictures chosen. */
    App.images.choose = function choose() {
        openPicker(null);
    };

    /* Picture Format > Change Picture: the file picker, then one picture in place of the selected one. */
    App.images.chooseReplacement = function chooseReplacement() {
        if (App.images.isPictureSelected()) {
            openPicker(App.selection.getElement());
        }
    };

    function openPicker(element) {
        const input = document.getElementById('picture-input');
        replacing = element;
        input.multiple = !element;
        input.value = '';
        input.click();
    }

    /* Wiring, called once from App.start(). */
    App.images.init = function init() {
        document.getElementById('picture-input').addEventListener('change', (event) => {
            const files = event.target.files;
            if (files.length === 0) {
                return;
            }
            App.text.exitEdit({ select: false });
            if (replacing) {
                App.images.replace(replacing, files[0]);
            } else {
                App.images.insertFiles(files);
            }
        });
    };
})();
