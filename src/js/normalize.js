/*
 * normalize.js - converts any deck layout into the editor's contract (SPEC 3.3, 3.4).
 *
 * The idea: we do not try to understand the deck's CSS. Instead we let the
 * browser lay the deck out in a hidden 1280x720 iframe, then *measure* where
 * every visible block ended up (getBoundingClientRect) and write that position
 * down in px. Styles that came from the deck's CSS rules (fonts, colors,
 * spacing) are copied inline, so each element looks the same after it is
 * moved out of its original container.
 *
 * What becomes what (option A, agreed with the user):
 *   heading / paragraph / list / text box  -> <div class="el" data-type="text">, its text
 *                                             converted to the text model (text.js fromRendered)
 *   icon (<svg>/<img>) inside a heading     -> its own element; the text box starts after it
 *   <img>                                  -> <img class="el" data-type="image">
 *   <table>                                -> <div class="el" data-type="table"> holding a table
 *                                             in the table model (tables.js fromRendered)
 *   <svg> or empty coloured box            -> data-type="shape"
 *   box with background/border (a "card")  -> a shape behind its contents,
 *                                             and the contents become their own elements
 *   chart <figure> with JSON               -> data-type="chart"
 *   <canvas> (drawn by a script we removed) -> removed, listed in the report
 *
 * Decks that already follow the contract are only checked and lightly repaired
 * (missing ids, missing z-index) - never rebuilt. If they are older than deck
 * format 2, their text is converted to the text model in place; older than
 * format 3, their tables to the table model; both while the measuring iframe
 * can still tell how they look.
 *
 * Talks to: importer.js (calls run), text.js and tables.js (fromRendered), util.js.
 */

(function () {
    'use strict';

    App.normalize = {};

    const SLIDE_WIDTH = 1280;
    const SLIDE_HEIGHT = 720;
    const ELEMENT_TYPES = ['text', 'image', 'table', 'shape', 'chart', 'group'];

    // The measuring iframe gets its own strict policy too, so a deck can never
    // load anything while we measure it, even when run from the test page.
    const MEASURE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";

    // Temporary rules, used only inside the measuring iframe.
    const MEASURE_STYLE =
        '[data-import-hide] { display: none !important; }\n' +
        '[data-import-show] { visibility: visible !important; opacity: 1 !important; transform: none !important; }\n';

    // Class names that decks commonly use to reveal "the current slide".
    const ACTIVE_CLASSES = ['active', 'current', 'present', 'visible', 'show'];

    const SKIP_TAGS = new Set(['script', 'style', 'link', 'meta', 'template', 'noscript', 'title', 'br', 'wbr']);
    const REMOVED_TAGS = {
        canvas: 'Canvas (it was drawn by a script, which was removed)',
        video: 'Video', audio: 'Audio',
    };
    const TEXT_TAGS = new Set([
        'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'dl', 'pre', 'blockquote', 'li',
        'span', 'a', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'label', 'button', 'figcaption',
        'code', 'sup', 'sub', 'mark', 'time', 'address', 'q', 'cite',
    ]);
    const INLINE_TAGS = new Set([
        'span', 'a', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'sup', 'sub', 'mark', 'code',
        'br', 'img', 'svg', 'time', 'q', 'cite', 'abbr', 'del', 'ins', 'kbd', 'var', 'wbr', 'label', 'font',
    ]);

    // Text properties: copied onto every text element, and onto its children when they differ.
    const TEXT_PROPS = [
        'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'color', 'line-height',
        'text-align', 'letter-spacing', 'word-spacing', 'text-transform', 'text-indent', 'text-shadow',
        'white-space', 'list-style-type', 'list-style-position', 'direction',
    ];
    const SIDES = ['top', 'right', 'bottom', 'left'];
    const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
    const FLEX_GRID_PROPS = [
        'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content', 'row-gap', 'column-gap',
        'grid-template-columns', 'grid-template-rows',
    ];

    // ---------------------------------------------------------------
    // The measuring iframe
    // ---------------------------------------------------------------

    function buildMeasureHtml(doc) {
        const copy = doc.cloneNode(true);
        const csp = copy.createElement('meta');
        csp.setAttribute('http-equiv', 'Content-Security-Policy');
        csp.setAttribute('content', MEASURE_CSP);
        copy.head.prepend(csp);
        const style = copy.createElement('style');
        style.textContent = MEASURE_STYLE;
        copy.head.appendChild(style);
        // Keep the deck's original rendering mode: without a doctype the browser uses
        // "quirks mode", which lays some things out slightly differently.
        return (doc.doctype ? '<!DOCTYPE html>\n' : '') + copy.documentElement.outerHTML;
    }

    /*
     * Load HTML into a hidden iframe and wait until it (and its fonts) are ready.
     * sandbox="allow-same-origin" without "allow-scripts": we can read its
     * layout, but nothing inside it can run.
     */
    function loadMeasureFrame(html) {
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-same-origin');
        frame.setAttribute('aria-hidden', 'true');
        frame.setAttribute('tabindex', '-1');
        frame.style.cssText = 'position:fixed; left:-20000px; top:0; width:' + SLIDE_WIDTH + 'px; height:' +
            SLIDE_HEIGHT + 'px; border:0; visibility:hidden; pointer-events:none';

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                frame.remove();
                reject(new Error('Timed out while measuring the deck layout'));
            }, 60000);
            frame.addEventListener('load', async () => {
                clearTimeout(timer);
                try {
                    await frame.contentDocument.fonts.ready;
                } catch (error) {
                    // fonts.ready is a nicety; measuring still works without it.
                }
                resolve(frame);
            }, { once: true });
            frame.srcdoc = html;
            document.body.appendChild(frame);
        });
    }

    // Jump CSS animations and transitions to their end, so we measure the final
    // look (Copilot decks often fade elements in from opacity 0).
    function finishAnimations(frameDoc) {
        if (!frameDoc.getAnimations) {
            return;
        }
        frameDoc.getAnimations().forEach((animation) => {
            try {
                animation.finish();
            } catch (error) {
                animation.cancel();   // infinite animations cannot finish
            }
        });
    }

    /* Show slide `index` alone, the way the deck's own script would have. */
    function showOnly(slides, index) {
        slides.forEach((slide, i) => {
            if (!slide.hasAttribute('data-import-class')) {
                slide.setAttribute('data-import-class', slide.getAttribute('class') || '');
            }
            slide.setAttribute('class', slide.getAttribute('data-import-class'));
            slide.style.removeProperty('display');
            slide.toggleAttribute('data-import-hide', i !== index);
            slide.toggleAttribute('data-import-show', i === index);
        });

        const slide = slides[index];
        if (slide.tagName.toLowerCase() === 'body') {
            return;
        }
        const view = slide.ownerDocument.defaultView;
        if (view.getComputedStyle(slide).display === 'none') {
            ACTIVE_CLASSES.forEach((name) => slide.classList.add(name));
        }
        if (view.getComputedStyle(slide).display === 'none') {
            slide.style.setProperty('display', 'block', 'important');
        }
        finishAnimations(slide.ownerDocument);
    }

    // ---------------------------------------------------------------
    // Size and scale
    // ---------------------------------------------------------------

    function measureSlideBox(slide) {
        if (slide.tagName.toLowerCase() === 'body') {
            const root = slide.ownerDocument.documentElement;
            return { originX: 0, originY: 0, width: root.scrollWidth, height: root.scrollHeight };
        }
        const rect = slide.getBoundingClientRect();
        return {
            originX: rect.left + slide.clientLeft,
            originY: rect.top + slide.clientTop,
            width: slide.offsetWidth,
            height: slide.offsetHeight,
        };
    }

    /*
     * How to fit a slide of width x height into 1280x720:
     *  - already 1280x720 (2 px tolerance)  -> scale 1
     *  - another 16:9 size (1920x1080 ...)  -> scale proportionally (SPEC 3.4)
     *  - not 16:9                           -> shrink to fit if too big, centred
     */
    App.normalize.scaleFor = function scaleFor(width, height) {
        if (Math.abs(width - SLIDE_WIDTH) <= 2 && Math.abs(height - SLIDE_HEIGHT) <= 2) {
            return { scale: 1, offsetX: 0, offsetY: 0, kind: 'exact' };
        }
        const ratio = width / height;
        const wide = SLIDE_WIDTH / SLIDE_HEIGHT;
        if (height > 0 && Math.abs(ratio - wide) / wide < 0.02) {
            return { scale: SLIDE_WIDTH / width, offsetX: 0, offsetY: 0, kind: '16:9' };
        }
        const scale = Math.min(1, SLIDE_WIDTH / width, SLIDE_HEIGHT / Math.max(height, 1));
        const offsetX = scale < 1 ? Math.max(0, (SLIDE_WIDTH - width * scale) / 2) : 0;
        return { scale: scale, offsetX: offsetX, offsetY: 0, kind: 'fit' };
    };

    // ---------------------------------------------------------------
    // Contract check and light repairs
    // ---------------------------------------------------------------

    function isNotes(element, computed) {
        if (element.matches('aside.notes')) {
            return true;
        }
        // A visible ".notes" box may be a footnote on the slide, so only hidden ones count.
        return element.matches('.notes, .speaker-notes, [data-notes]') && computed.display === 'none';
    }

    function isContractSlide(slide) {
        const view = slide.ownerDocument.defaultView;
        const hasLooseText = Array.from(slide.childNodes).some((node) => {
            return node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '';
        });
        if (hasLooseText) {
            return false;
        }
        return Array.from(slide.children).every((child) => {
            const computed = view.getComputedStyle(child);
            if (isNotes(child, computed) || SKIP_TAGS.has(child.tagName.toLowerCase())) {
                return true;
            }
            return child.classList.contains('el') &&
                ELEMENT_TYPES.indexOf(child.getAttribute('data-type')) !== -1 &&
                computed.position === 'absolute';
        });
    }

    function plural(count, word, pluralWord) {
        return count + ' ' + (count === 1 ? word : pluralWord || word + 's');
    }

    /* Fill in missing or duplicate ids and missing z-index on a contract deck. */
    function applyContractFixes(slides, report) {
        const slideIds = new Set();
        const elementIds = new Set();
        let addedSlideIds = 0;
        let addedElementIds = 0;
        let addedZ = 0;

        // First pass: remember the ids that are already fine, so new ones never clash.
        slides.forEach((slide) => {
            const id = slide.getAttribute('data-slide-id');
            if (id && !slideIds.has(id)) {
                slideIds.add(id);
            } else {
                slide.removeAttribute('data-slide-id');
            }
            slide.querySelectorAll(':scope > .el').forEach((el) => {
                const elId = el.getAttribute('data-id');
                if (elId && !elementIds.has(elId)) {
                    elementIds.add(elId);
                } else {
                    el.removeAttribute('data-id');
                }
            });
        });

        slides.forEach((slide) => {
            if (!slide.getAttribute('data-slide-id')) {
                slide.setAttribute('data-slide-id', App.util.uniqueId('s', slideIds));
                addedSlideIds += 1;
            }
            slide.querySelectorAll(':scope > .el').forEach((el, index) => {
                if (!el.getAttribute('data-id')) {
                    el.setAttribute('data-id', App.util.uniqueId('e', elementIds));
                    addedElementIds += 1;
                }
                if (el.style.zIndex === '') {
                    el.style.zIndex = String(index + 1);
                    addedZ += 1;
                }
            });
        });

        if (addedSlideIds) {
            report.fixes.push('Added ' + plural(addedSlideIds, 'missing slide id'));
        }
        if (addedElementIds) {
            report.fixes.push('Added ' + plural(addedElementIds, 'missing element id'));
        }
        if (addedZ) {
            report.fixes.push('Added a stacking order (z-index) to ' + plural(addedZ, 'element'));
        }
    }

    // ---------------------------------------------------------------
    // Classifying what we find on a slide
    // ---------------------------------------------------------------

    function isTransparent(color) {
        return !color || color === 'transparent' || /rgba\(.*,\s*0\)$/.test(color);
    }

    function hasBorder(computed) {
        return SIDES.some((side) => {
            return computed.getPropertyValue('border-' + side + '-style') !== 'none' &&
                parseFloat(computed.getPropertyValue('border-' + side + '-width')) > 0;
        });
    }

    /* Does the box itself paint something (background, border or shadow)? */
    function hasVisibleBox(computed) {
        return !isTransparent(computed.backgroundColor) || computed.backgroundImage !== 'none' ||
            hasBorder(computed) || computed.boxShadow !== 'none';
    }

    function hasDirectText(element) {
        return Array.from(element.childNodes).some((node) => {
            return node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '';
        });
    }

    function tagOf(element) {
        return element.tagName.toLowerCase();
    }

    function visibleChildren(element) {
        const view = element.ownerDocument.defaultView;
        return Array.from(element.children).filter((child) => {
            return !SKIP_TAGS.has(tagOf(child)) && view.getComputedStyle(child).display !== 'none';
        });
    }

    function isInlineLevel(element) {
        const display = element.ownerDocument.defaultView.getComputedStyle(element).display;
        return INLINE_TAGS.has(tagOf(element)) && ['block', 'flex', 'grid', 'table', 'list-item'].indexOf(display) === -1;
    }

    function isPicture(element) {
        return tagOf(element) === 'img' || tagOf(element) === 'svg';
    }

    /*
     * Decide what an element on the slide is:
     *   'existing'  already an editor element (.el with a data-type)
     *   'image' | 'svg' | 'table' | 'chart' | 'text'
     *   'box'       empty element that paints something (a coloured bar, a circle)
     *   'container' holds other blocks: look inside
     *   'empty'     nothing visible
     */
    function classify(element, computed) {
        const tag = tagOf(element);
        if (element.classList.contains('el') && ELEMENT_TYPES.indexOf(element.getAttribute('data-type')) !== -1) {
            return 'existing';
        }
        if (tag === 'img') {
            return 'image';
        }
        if (tag === 'svg') {
            return 'svg';
        }
        if (tag === 'table') {
            return 'table';
        }
        if (tag === 'figure' && element.querySelector('script.chart-data')) {
            return 'chart';
        }
        if (TEXT_TAGS.has(tag) || hasDirectText(element)) {
            return 'text';
        }
        const children = visibleChildren(element);
        if (children.length === 0) {
            return hasVisibleBox(computed) ? 'box' : 'empty';
        }
        // Only inline content (text with <b>, <span> ...) -> one text box. But a
        // wrapper holding only pictures is a container, so each picture is its own element.
        if (children.every(isInlineLevel) && !children.every(isPicture)) {
            return 'text';
        }
        return 'container';
    }

    // ---------------------------------------------------------------
    // Copying computed styles inline
    // ---------------------------------------------------------------

    function makeWriter(target, scale) {
        return function write(property, value) {
            if (value === '' || value === null || value === undefined) {
                return;
            }
            // Never copy a remote url() inline: it would be blocked anyway.
            if (/url\(\s*['"]?\s*(https?:)?\/\//i.test(value)) {
                return;
            }
            const scaled = scale === 1 ? value : App.util.scalePxValues(value, scale);
            target.style.setProperty(property, scaled);
        };
    }

    function writeBoxStyles(write, computed, includePadding) {
        if (includePadding) {
            SIDES.forEach((side) => {
                const value = computed.getPropertyValue('padding-' + side);
                if (value !== '0px') {
                    write('padding-' + side, value);
                }
            });
        }
        SIDES.forEach((side) => {
            const style = computed.getPropertyValue('border-' + side + '-style');
            const width = computed.getPropertyValue('border-' + side + '-width');
            if (style !== 'none' && parseFloat(width) > 0) {
                write('border-' + side + '-width', width);
                write('border-' + side + '-style', style);
                write('border-' + side + '-color', computed.getPropertyValue('border-' + side + '-color'));
            }
        });
        CORNERS.forEach((corner) => {
            const value = computed.getPropertyValue('border-' + corner + '-radius');
            if (value !== '0px') {
                write('border-' + corner + '-radius', value);
            }
        });
        if (!isTransparent(computed.backgroundColor)) {
            write('background-color', computed.backgroundColor);
        }
        if (computed.backgroundImage !== 'none') {
            write('background-image', computed.backgroundImage);
            write('background-size', computed.backgroundSize);
            write('background-position', computed.backgroundPosition);
            write('background-repeat', computed.backgroundRepeat);
        }
        if (computed.boxShadow !== 'none') {
            write('box-shadow', computed.boxShadow);
        }
    }

    function writeDecoration(write, computed) {
        if (computed.textDecorationLine && computed.textDecorationLine !== 'none') {
            write('text-decoration-line', computed.textDecorationLine);
            write('text-decoration-style', computed.textDecorationStyle);
            write('text-decoration-color', computed.textDecorationColor);
        }
        if (computed.verticalAlign !== 'baseline') {
            write('vertical-align', computed.verticalAlign);
        }
    }

    function writeFlexGrid(write, computed) {
        const display = computed.display;
        if (display.indexOf('flex') !== -1 || display.indexOf('grid') !== -1) {
            FLEX_GRID_PROPS.forEach((property) => {
                const value = computed.getPropertyValue(property);
                if (value && value !== 'normal' && value !== 'none') {
                    write(property, value);
                }
            });
        }
    }

    function displayIsNoteworthy(element, display) {
        if (['flex', 'grid', 'inline-flex', 'inline-grid', 'inline-block', 'none'].indexOf(display) !== -1) {
            return true;
        }
        const inlineTag = INLINE_TAGS.has(tagOf(element));
        return (inlineTag && display === 'block') || (!inlineTag && display === 'inline');
    }

    function isDecorativeBox(element, computed) {
        return element.children.length === 0 && element.textContent.trim() === '' && hasVisibleBox(computed);
    }

    /*
     * Copy styles from `original` (in the measuring iframe) onto its copy `clone`,
     * then do the same for every child. `parentComputed` is null for the root.
     */
    function copyStyles(clone, original, scale, parentComputed) {
        const view = original.ownerDocument.defaultView;
        const computed = view.getComputedStyle(original);
        const write = makeWriter(clone, scale);
        const isRoot = parentComputed === null;
        const tag = tagOf(original);

        if (original.namespaceURI === 'http://www.w3.org/2000/svg' && tag !== 'svg') {
            copySvgPaint(clone, original, computed, parentComputed);
            return;
        }

        TEXT_PROPS.forEach((property) => {
            const value = computed.getPropertyValue(property);
            if (isRoot || value !== parentComputed.getPropertyValue(property)) {
                write(property, value);
            }
        });
        writeBoxStyles(write, computed, true);
        writeDecoration(write, computed);

        if (!isRoot) {
            const isBlock = computed.display !== 'inline' && computed.display !== 'none';
            if (isBlock) {
                write('margin', SIDES.map((side) => computed.getPropertyValue('margin-' + side)).join(' '));
            }
            if (displayIsNoteworthy(original, computed.display)) {
                write('display', computed.display);
            }
            if (isPicture(original) || isDecorativeBox(original, computed)) {
                write('width', computed.width);
                write('height', computed.height);
            }
        }
        writeFlexGrid(write, computed);

        if (tag === 'svg' && !isRoot) {
            return;   // pictures keep their own internal styling
        }
        const cloneChildren = Array.from(clone.children);
        Array.from(original.children).forEach((child, index) => {
            if (cloneChildren[index]) {
                copyStyles(cloneChildren[index], child, scale, computed);
            }
        });
    }

    // Inside an SVG, keep only colours that came from CSS rules (attributes stay as they are).
    function copySvgPaint(clone, original, computed, parentComputed) {
        ['fill', 'stroke'].forEach((property) => {
            const value = computed.getPropertyValue(property);
            if (!original.hasAttribute(property) && parentComputed && value !== parentComputed.getPropertyValue(property)) {
                clone.style.setProperty(property, value);
            }
        });
        const cloneChildren = Array.from(clone.children);
        Array.from(original.children).forEach((child, index) => {
            if (cloneChildren[index]) {
                copySvgPaint(cloneChildren[index], child, child.ownerDocument.defaultView.getComputedStyle(child), computed);
            }
        });
    }

    // ---------------------------------------------------------------
    // Building editor elements
    // ---------------------------------------------------------------

    function effectiveOpacity(element, slide) {
        const view = element.ownerDocument.defaultView;
        let opacity = 1;
        for (let node = element; node && node !== slide; node = node.parentElement) {
            opacity *= parseFloat(view.getComputedStyle(node).opacity);
        }
        return App.util.round2(opacity);
    }

    // The stacking level an element inherits from its nearest positioned ancestor with a z-index.
    function stackLevel(element, slide) {
        const view = element.ownerDocument.defaultView;
        for (let node = element; node && node !== slide; node = node.parentElement) {
            const computed = view.getComputedStyle(node);
            if (computed.position !== 'static' && computed.zIndex !== 'auto') {
                return parseInt(computed.zIndex, 10) || 0;
            }
        }
        return 0;
    }

    function placement(element, ctx) {
        return placementOf(element.getBoundingClientRect(), ctx);
    }

    /* A rectangle measured in the iframe -> left/top/width/height on the 1280x720 slide. */
    function placementOf(rect, ctx) {
        const s = ctx.fit.scale;
        return {
            left: Math.round((rect.left - ctx.box.originX) * s + ctx.fit.offsetX),
            top: Math.round((rect.top - ctx.box.originY) * s + ctx.fit.offsetY),
            width: Math.ceil(rect.width * s - 0.01),
            height: Math.ceil(rect.height * s - 0.01),
        };
    }

    function setPosition(node, box) {
        node.style.setProperty('left', box.left + 'px');
        node.style.setProperty('top', box.top + 'px');
        node.style.setProperty('width', box.width + 'px');
        node.style.setProperty('height', box.height + 'px');
    }

    function wrapperElement(out, type, box) {
        const wrapper = out.createElement('div');
        wrapper.setAttribute('class', 'el');
        wrapper.setAttribute('data-type', type);
        setPosition(wrapper, box);
        return wrapper;
    }

    /*
     * text: an .el wrapper whose text is converted to the text model (text.js),
     * keeping the look. The block's padding, border and background stay on the
     * wrapper, unless pictures were taken out of it (then the box is the text only).
     */
    function buildText(out, element, box, ctx, textOnly) {
        const computed = element.ownerDocument.defaultView.getComputedStyle(element);
        const wrapper = wrapperElement(out, 'text', box);
        if (!textOnly) {
            writeBoxStyles(makeWriter(wrapper, ctx.fit.scale), computed, true);
        }
        const opacity = effectiveOpacity(element, ctx.slide);
        if (opacity < 1) {
            wrapper.style.setProperty('opacity', String(opacity));
        }
        convertText(element, wrapper, ctx, true);
        return wrapper;
    }

    function convertText(source, target, ctx, includeSource) {
        const result = App.text.fromRendered(source, target, { scale: ctx.fit.scale, includeSource: includeSource });
        ctx.report.textConverted += 1;
        if (result.layoutFlattened) {
            ctx.textChecks.push({ node: target, slideNumber: ctx.slideNumber });
        }
    }

    /* table: an .el wrapper holding the table converted to the table model, keeping its look. */
    function buildTable(out, element, box, ctx) {
        const wrapper = wrapperElement(out, 'table', box);
        const opacity = effectiveOpacity(element, ctx.slide);
        if (opacity < 1) {
            wrapper.style.setProperty('opacity', String(opacity));
        }
        convertTable(element, wrapper, ctx);
        return wrapper;
    }

    function convertTable(source, target, ctx) {
        const result = App.tables.fromRendered(source, target, { scale: ctx.fit.scale });
        ctx.report.tablesConverted += 1;
        if (result.caption) {
            ctx.report.warnings.push('Slide ' + ctx.slideNumber + ': the table title "' + result.caption +
                '" was left out (a table has no place for it); add it as a text box if you need it.');
        }
    }

    /* image, svg, chart and existing elements: the element itself becomes the .el. */
    function buildSelf(out, element, type, box, ctx) {
        const view = element.ownerDocument.defaultView;
        const computed = view.getComputedStyle(element);
        const clone = out.importNode(element, type !== 'text');   // text is rebuilt by convertText
        clone.removeAttribute('data-import-text');
        clone.classList.add('el');
        clone.setAttribute('data-type', type);
        // Remove the old inline position first so ours comes first in the style attribute.
        ['left', 'top', 'right', 'bottom', 'width', 'height', 'z-index', 'position', 'inset'].forEach((property) => {
            clone.style.removeProperty(property);
        });
        setPosition(clone, box);

        const write = makeWriter(clone, ctx.fit.scale);
        writeBoxStyles(write, computed, type !== 'image');
        if (type === 'image') {
            write('object-fit', computed.objectFit);
            write('object-position', computed.objectPosition);
        } else if (type === 'text') {
            convertText(element, clone, ctx, false);
        } else {
            TEXT_PROPS.forEach((property) => write(property, computed.getPropertyValue(property)));
            const cloneChildren = Array.from(clone.children);
            Array.from(element.children).forEach((child, index) => {
                if (cloneChildren[index]) {
                    copyStyles(cloneChildren[index], child, ctx.fit.scale, computed);
                }
            });
        }
        clone.style.setProperty('box-sizing', 'border-box');
        clone.style.setProperty('margin', '0');
        clone.style.setProperty('transform', 'none');
        clone.style.setProperty('max-width', 'none');
        const opacity = effectiveOpacity(element, ctx.slide);
        if (opacity < 1) {
            clone.style.setProperty('opacity', String(opacity));
        }
        return clone;
    }

    /* A coloured box (card background, bar, circle) without its contents. */
    function buildShape(out, element, box, ctx) {
        const computed = element.ownerDocument.defaultView.getComputedStyle(element);
        const shape = wrapperElement(out, 'shape', box);
        writeBoxStyles(makeWriter(shape, ctx.fit.scale), computed, false);
        const opacity = effectiveOpacity(element, ctx.slide);
        if (opacity < 1) {
            shape.style.setProperty('opacity', String(opacity));
        }
        return shape;
    }

    function hasArea(box) {
        return box.width > 0 && box.height > 0;
    }

    function describeElement(element) {
        const id = element.id ? '#' + element.id : '';
        return '<' + tagOf(element) + id + '>';
    }

    /*
     * Walk through a slide and turn everything visible into editor elements.
     * Results go into ctx.items ({ node, z, order }), ctx.notes and ctx.removed.
     */
    function collect(parent, ctx) {
        const view = parent.ownerDocument.defaultView;
        Array.from(parent.children).forEach((element) => {
            const tag = tagOf(element);
            if (SKIP_TAGS.has(tag)) {
                return;
            }
            const computed = view.getComputedStyle(element);
            if (isNotes(element, computed)) {
                ctx.notes.push(element.innerHTML.trim());
                return;
            }
            if (computed.display === 'none' || element.closest('.master')) {
                return;
            }
            if (REMOVED_TAGS[tag]) {
                ctx.removed.push(REMOVED_TAGS[tag] + ' ' + describeElement(element) + ' on slide ' + ctx.slideNumber);
                return;
            }

            const kind = classify(element, computed);
            if (kind === 'empty') {
                return;
            }
            if (kind === 'container') {
                if (hasVisibleBox(computed)) {
                    addItem(ctx, element, buildShape(ctx.out, element, placement(element, ctx), ctx));
                }
                collect(element, ctx);
                return;
            }
            if (computed.visibility === 'hidden') {
                return;
            }
            const box = placement(element, ctx);
            if (!hasArea(box)) {
                return;
            }
            if (kind === 'text' && picturesInside(element).length > 0) {
                addTextWithPictures(element, ctx);
                return;
            }
            addItem(ctx, element, buildElement(kind, element, box, ctx));
        });
    }

    /* Visible <img>/<svg> inside a text block (icons next to a heading …), outermost only. */
    function picturesInside(element) {
        const view = element.ownerDocument.defaultView;
        return Array.from(element.querySelectorAll('img, svg')).filter((picture) => {
            return !picture.parentElement.closest('svg') && view.getComputedStyle(picture).display !== 'none';
        });
    }

    /*
     * The text model has no pictures, so each icon becomes its own element at its
     * measured place, and the text box covers only where the text is (from the
     * left of the first character to the right edge of the block).
     */
    function addTextWithPictures(element, ctx) {
        picturesInside(element).forEach((picture) => {
            const box = placement(picture, ctx);
            if (hasArea(box)) {
                addItem(ctx, picture, buildElement(tagOf(picture) === 'img' ? 'image' : 'svg', picture, box, ctx));
            }
        });
        const range = element.ownerDocument.createRange();
        let textLeft = Infinity;
        const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (node.textContent.trim() === '' || node.parentElement.closest('svg')) {
                continue;
            }
            range.selectNodeContents(node);
            Array.from(range.getClientRects()).forEach((rect) => { textLeft = Math.min(textLeft, rect.left); });
        }
        if (textLeft === Infinity) {
            return;   // only pictures
        }
        const rect = element.getBoundingClientRect();
        const box = placementOf({ left: textLeft, top: rect.top, width: rect.right - textLeft, height: rect.height }, ctx);
        addItem(ctx, element, buildText(ctx.out, element, box, ctx, true));
    }

    function buildElement(kind, element, box, ctx) {
        const out = ctx.out;
        switch (kind) {
            case 'text': return buildText(out, element, box, ctx, false);
            case 'table': return buildTable(out, element, box, ctx);
            case 'image': return buildSelf(out, element, 'image', box, ctx);
            case 'svg': return buildSelf(out, element, 'shape', box, ctx);
            case 'chart': return buildSelf(out, element, 'chart', box, ctx);
            case 'existing': return buildSelf(out, element, element.getAttribute('data-type'), box, ctx);
            default: return buildShape(out, element, box, ctx);   // 'box'
        }
    }

    function addItem(ctx, original, node) {
        ctx.items.push({ node: node, z: stackLevel(original, ctx.slide), order: ctx.items.length });
    }

    // ---------------------------------------------------------------
    // Building the normalized deck
    // ---------------------------------------------------------------

    const BASE_CSS =
        'section.slide { position: relative !important; width: 1280px !important; height: 720px !important;' +
        ' overflow: hidden !important; box-sizing: border-box; }\n' +
        'section.slide > .el { position: absolute; box-sizing: border-box; }\n';

    function nearestBackground(slide) {
        const view = slide.ownerDocument.defaultView;
        for (let node = slide; node; node = node.parentElement) {
            const computed = view.getComputedStyle(node);
            if (!isTransparent(computed.backgroundColor) || computed.backgroundImage !== 'none') {
                return computed;
            }
        }
        return null;
    }

    /*
     * Write the full background inline, including "background-image: none":
     * the new <section class="slide"> still matches the deck's shared .slide
     * rule, and its gradient must not come back on a slide that had none.
     */
    function writeSlideBackground(section, frameSlide, scale) {
        const write = makeWriter(section, scale);
        const computed = nearestBackground(frameSlide);
        if (!computed) {
            write('background-color', '#ffffff');
            write('background-image', 'none');
            return;
        }
        write('background-color', computed.backgroundColor);
        write('background-image', computed.backgroundImage);
        if (computed.backgroundImage !== 'none') {
            write('background-image', computed.backgroundImage);
            write('background-size', computed.backgroundSize);
            write('background-position', computed.backgroundPosition);
            write('background-repeat', computed.backgroundRepeat);
        }
    }

    function buildHead(out, doc) {
        const charset = out.createElement('meta');
        charset.setAttribute('charset', 'utf-8');
        out.head.appendChild(charset);
        const format = out.createElement('meta');
        format.setAttribute('name', 'deck-format');
        format.setAttribute('content', String(App.DECK_FORMAT));
        out.head.appendChild(format);
        if (doc.title) {
            const title = out.createElement('title');
            title.textContent = doc.title;
            out.head.appendChild(title);
        }
        // Keep the deck's own CSS (theme variables, fonts, ::before decorations ...).
        doc.querySelectorAll('style, link[rel~="stylesheet"]').forEach((node) => {
            out.head.appendChild(out.importNode(node, true));
        });
        const base = out.createElement('style');
        base.setAttribute('data-deck-base', '');
        base.textContent = BASE_CSS;
        out.head.appendChild(base);
    }

    function buildNormalizedDeck(doc, slides, report) {
        const out = document.implementation.createHTMLDocument('');
        out.documentElement.setAttribute('lang', doc.documentElement.getAttribute('lang') || 'pt-BR');
        out.title = '';
        out.head.innerHTML = '';
        buildHead(out, doc);

        const usedIds = new Set();
        const textChecks = [];   // text boxes whose side-by-side layout was flattened
        slides.forEach((frameSlide, index) => {
            showOnly(slides, index);
            const box = measureSlideBox(frameSlide);
            const fit = App.normalize.scaleFor(box.width, box.height);
            describeFit(fit, box, index, report);

            const section = out.createElement('section');
            section.setAttribute('class', 'slide');
            section.setAttribute('data-slide-id', 's' + (index + 1));
            if (frameSlide.getAttribute('data-hidden') === 'true') {
                section.setAttribute('data-hidden', 'true');
            }
            writeSlideBackground(section, frameSlide, fit.scale);

            const ctx = {
                out: out, slide: frameSlide, box: box, fit: fit, slideNumber: index + 1,
                items: [], notes: [], removed: report.otherRemoved, report: report, textChecks: textChecks,
            };
            collect(frameSlide, ctx);

            // Stable sort by stacking level, keeping page order for equal levels.
            ctx.items.sort((a, b) => (a.z - b.z) || (a.order - b.order));
            ctx.items.forEach((item, position) => {
                const existingId = item.node.getAttribute('data-id');
                const id = existingId && !usedIds.has(existingId) ? existingId : App.util.uniqueId('e', usedIds);
                usedIds.add(id);
                item.node.setAttribute('data-id', id);
                item.node.style.setProperty('z-index', String(position + 1));
                section.appendChild(item.node);
            });
            report.elementsConverted += ctx.items.length;

            const notes = out.createElement('aside');
            notes.setAttribute('class', 'notes');
            notes.innerHTML = ctx.notes.join('\n');
            section.appendChild(notes);
            out.body.appendChild(section);
        });

        const master = doc.querySelector('.master');
        if (master) {
            out.body.appendChild(out.importNode(master, true));
        }
        reportContentOutsideSlides(slides, report);
        reportTextChecks(textChecks, report);
        return out;
    }

    /* One warning listing the text boxes to look at (ids are known only once the slide is built). */
    function reportTextChecks(checks, report) {
        if (checks.length === 0) {
            return;
        }
        const where = checks.slice(0, 8).map((check) => 'slide ' + check.slideNumber + ' (' + check.node.getAttribute('data-id') + ')');
        report.warnings.push('Text in ' + plural(checks.length, 'box', 'boxes') + ' sat side by side (columns, a grid) and now ' +
            'runs as lines one below the other; check ' + (checks.length === 1 ? 'it' : 'them') + ': ' +
            where.join(', ') + (checks.length > 8 ? ' …' : ''));
    }

    /*
     * Older contract decks: convert the text of every text element (format 1) and
     * the tables (formats 1-2) in place, slide by slide (a slide must be shown to
     * measure its layout).
     */
    function convertContract(frameDoc, doc, slides, report) {
        const textChecks = [];
        const shouldConvertText = needsConversion(doc, TEXT_MODEL_FORMAT);
        const convertTables = needsConversion(doc, TABLE_MODEL_FORMAT);
        const convertIn = (scope, slideNumber) => {
            const ctx = { fit: { scale: 1 }, report: report, textChecks: textChecks, slideNumber: slideNumber };
            if (shouldConvertText) {
                scope.querySelectorAll('.el[data-type="text"][data-import-text]').forEach((source) => {
                    const target = doc.querySelector('[data-import-text="' + source.getAttribute('data-import-text') + '"]');
                    convertText(source, target, ctx, false);
                });
            }
            if (convertTables) {
                scope.querySelectorAll('.el[data-type="table"][data-import-table]').forEach((source) => {
                    const table = source.querySelector('table');
                    if (table) {
                        convertTable(table, doc.querySelector('[data-import-table="' +
                            source.getAttribute('data-import-table') + '"]'), ctx);
                    }
                });
            }
        };
        slides.forEach((slide, index) => {
            showOnly(slides, index);
            convertIn(slide, index + 1);
        });
        const master = frameDoc.querySelector('.master');
        if (master) {
            convertIn(master, 'master');
        }
        reportTextChecks(textChecks, report);
    }

    // Decks saved before format 2 hold their text as <h1>, <ul> …; before format 3,
    // their tables as the deck's own HTML and CSS.
    const TEXT_MODEL_FORMAT = 2;
    const TABLE_MODEL_FORMAT = 3;

    function needsConversion(doc, modelFormat) {
        const meta = doc.head && doc.head.querySelector('meta[name="deck-format"]');
        return !meta || (parseInt(meta.getAttribute('content'), 10) || 1) < modelFormat;
    }

    function describeTag(element) {
        const className = element.getAttribute('class');
        return '<' + tagOf(element) + (className ? ' class="' + className + '"' : '') + '>';
    }

    /*
     * Normalization keeps only the slides, so list visible things that sit
     * outside every slide (a deck's own navigation bar, a page header ...).
     */
    function findContentOutsideSlides(parent, slides, found) {
        const view = parent.ownerDocument.defaultView;
        Array.from(parent.children).forEach((element) => {
            if (SKIP_TAGS.has(tagOf(element)) || slides.indexOf(element) !== -1 || element.closest('.master')) {
                return;
            }
            if (slides.some((slide) => element.contains(slide))) {
                findContentOutsideSlides(element, slides, found);   // a wrapper around slides: look inside
                return;
            }
            const rect = element.getBoundingClientRect();
            if (view.getComputedStyle(element).display !== 'none' && rect.width > 0 && rect.height > 0) {
                found.push(describeTag(element));
            }
        });
        return found;
    }

    function reportContentOutsideSlides(slides, report) {
        if (slides.length === 1 && tagOf(slides[0]) === 'body') {
            return;
        }
        const leftOut = findContentOutsideSlides(slides[0].ownerDocument.body, slides, []);
        if (leftOut.length) {
            const shown = leftOut.slice(0, 5).join(', ') + (leftOut.length > 5 ? ' …' : '');
            report.warnings.push(plural(leftOut.length, 'item') + ' outside the slides ' +
                (leftOut.length === 1 ? 'was' : 'were') + ' left out: ' + shown);
        }
    }

    function describeFit(fit, box, index, report) {
        const size = Math.round(box.width) + '×' + Math.round(box.height);
        if (fit.kind === '16:9' && !report.scaledFrom) {
            report.scaledFrom = size;
        } else if (fit.kind === 'fit') {
            report.warnings.push('Slide ' + (index + 1) + ' was ' + size + ' (not 16:9)' +
                (fit.scale < 1 ? '; it was shrunk to fit 1280×720.' : '; it was placed at the top left.'));
        }
    }

    // ---------------------------------------------------------------
    // Finding slides by size (the last rule of SPEC 3.4)
    // ---------------------------------------------------------------

    function findLargeBlocks(frameDoc) {
        const candidates = Array.from(frameDoc.body.querySelectorAll('*')).filter((element) => {
            const width = element.offsetWidth;
            const height = element.offsetHeight;
            return width >= 640 && height > 0 && Math.abs(width / height - 16 / 9) < 0.05;
        });
        return candidates.filter((candidate) => {
            return !candidates.some((other) => other !== candidate && other.contains(candidate));
        });
    }

    // ---------------------------------------------------------------
    // Entry point
    // ---------------------------------------------------------------

    /*
     * Measure the deck and return a Document in contract format.
     * `detected` comes from importer.detectSlides(doc); `report` is filled in.
     */
    App.normalize.run = async function run(doc, detected, report) {
        detected.slides.forEach((slide, index) => slide.setAttribute('data-import-slide', String(index)));
        const textElements = Array.from(doc.querySelectorAll('.el[data-type="text"]'));
        textElements.forEach((element, index) => element.setAttribute('data-import-text', String(index)));
        const tableElements = Array.from(doc.querySelectorAll('.el[data-type="table"]'));
        tableElements.forEach((element, index) => element.setAttribute('data-import-table', String(index)));
        const frame = await loadMeasureFrame(buildMeasureHtml(doc));

        try {
            const frameDoc = frame.contentDocument;
            let slides = detected.slides.map((slide, index) => {
                return frameDoc.querySelector('[data-import-slide="' + index + '"]');
            });
            let method = detected.method;

            if (slides.length === 0) {
                slides = findLargeBlocks(frameDoc);
                method = slides.length ? 'size' : null;
            }
            if (slides.length === 0) {
                slides = [frameDoc.body];
                method = 'whole-page';
                report.warnings.push('No slides were found, so the whole page was imported as one slide.');
            }
            report.method = method;
            report.slideCount = slides.length;

            if (method === 'section.slide' && allSlidesFollowContract(slides)) {
                report.isContract = true;
                applyContractFixes(detected.slides, report);
                if (needsConversion(doc, TABLE_MODEL_FORMAT)) {
                    convertContract(frameDoc, doc, slides, report);
                }
                return doc;
            }
            return buildNormalizedDeck(doc, slides, report);
        } finally {
            detected.slides.forEach((slide) => slide.removeAttribute('data-import-slide'));
            textElements.forEach((element) => element.removeAttribute('data-import-text'));
            tableElements.forEach((element) => element.removeAttribute('data-import-table'));
            frame.remove();
        }
    };

    function allSlidesFollowContract(slides) {
        return slides.every((slide, index) => {
            showOnly(slides, index);
            const box = measureSlideBox(slide);
            return App.normalize.scaleFor(box.width, box.height).kind === 'exact' && isContractSlide(slide);
        });
    }
})();
