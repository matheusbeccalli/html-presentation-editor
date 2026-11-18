/*
 * util.js - small helper functions used across the editor.
 *
 * Everything here is "pure": same input, same output, no page access.
 * Tested in tests/unit/util.test.js.
 *
 * Talks to: nothing (other files call it).
 */

App.util = {};

// Screen pixels per inch. PowerPoint and print both use 96 px = 1 inch,
// so a 1280x720 slide is exactly 13.333 x 7.5 inches (SPEC 7.2, 7.4).
App.util.PX_PER_INCH = 96;

App.util.pxToInches = function pxToInches(px) {
    return px / App.util.PX_PER_INCH;
};

App.util.inchesToPx = function inchesToPx(inches) {
    return inches * App.util.PX_PER_INCH;
};

// Round to at most two decimals and drop trailing zeros: 6.6666 -> 6.67, 5.00 -> 5.
App.util.round2 = function round2(value) {
    return Math.round(value * 100) / 100;
};

/*
 * Multiply every "<number>px" inside a CSS value by `factor`.
 *   scalePxValues('10px 20px', 0.5)  ->  '5px 10px'
 * Used when a 1920x1080 deck is scaled down to 1280x720.
 * Values containing url(...) are returned unchanged, because base64 image
 * data can contain letters like "3px" that are not lengths at all.
 */
App.util.scalePxValues = function scalePxValues(value, factor) {
    if (value.indexOf('url(') !== -1) {
        return value;
    }
    return value.replace(/(-?\d*\.?\d+)px/g, (match, number) => {
        return App.util.round2(parseFloat(number) * factor) + 'px';
    });
};

App.util.formatBytes = function formatBytes(bytes) {
    if (bytes < 1024) {
        return bytes + ' B';
    }
    if (bytes < 1024 * 1024) {
        return (bytes / 1024).toFixed(1) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

// Make text safe to put inside HTML (so "<b>" shows as text, not as bold).
App.util.escapeHtml = function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

/*
 * Return the first id "<prefix><n>" (n = 1, 2, 3 ...) that is not in `usedIds`,
 * and add it to the set so the next call gets a different one.
 */
/* UTF-8 text as base64 and back (btoa alone only takes Latin-1): copied slides and elements on the clipboard. */
App.util.toBase64 = function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
};

App.util.fromBase64 = function fromBase64(code) {
    const binary = atob(code);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
};

/*
 * Links to slides (#slide-<id>) in `root` that came from another deck: a link to
 * one of the slides that came along (idMap: old id -> new id) follows it; any
 * other is taken off (its text stays), since that slide is not in this deck.
 */
App.util.fixForeignSlideLinks = function fixForeignSlideLinks(root, idMap) {
    root.querySelectorAll('a[href^="#slide-"]').forEach((link) => {
        const id = link.getAttribute('href').slice(7);
        if (idMap && idMap.has(id)) {
            link.setAttribute('href', '#slide-' + idMap.get(id));
        } else {
            link.replaceWith(...Array.from(link.childNodes));
        }
    });
};

App.util.uniqueId = function uniqueId(prefix, usedIds) {
    let n = 1;
    while (usedIds.has(prefix + n)) {
        n += 1;
    }
    const id = prefix + n;
    usedIds.add(id);
    return id;
};

/*
 * Wrap `fn` so it only runs once calls stop for `waitMs` milliseconds.
 * Used for things like re-drawing thumbnails while the user keeps editing.
 */
App.util.debounce = function debounce(fn, waitMs) {
    let timer = null;
    return function debounced(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), waitMs);
    };
};

/*
 * Create a DOM element in one call:
 *   App.util.el('button', { class: 'btn', title: 'Save' }, ['Save'])
 * Attributes whose name starts with "on" are added as event listeners.
 */
App.util.el = function el(tag, attributes, children) {
    const element = document.createElement(tag);
    Object.entries(attributes || {}).forEach(([name, value]) => {
        if (name.startsWith('on') && typeof value === 'function') {
            element.addEventListener(name.slice(2), value);
        } else if (value !== null && value !== undefined && value !== false) {
            element.setAttribute(name, value === true ? '' : value);
        }
    });
    (children || []).forEach((child) => {
        element.append(child instanceof Node ? child : String(child));
    });
    return element;
};
