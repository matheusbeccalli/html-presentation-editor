/*
 * importer.js - turns any HTML file into a deck the editor can work on (SPEC 3.4).
 *
 * Steps, in order (importDeck at the bottom runs them):
 *   1. parse     the text into a Document that is never displayed
 *   2. sanitize  remove the deck's own scripts, onclick=... handlers, iframes ...
 *                (Copilot decks often carry navigation code)
 *   3. collect   remote fonts / images (the CSP blocks them) and local files
 *                (the editor cannot read them), for the report
 *   4. detect    which elements are the slides
 *   5. normalize (normalize.js) measure the real layout and convert it to the
 *                contract: absolute px positions, 1280x720; text of older
 *                decks goes to the text model (text.js), keeping its look
 *   6. render    charts that have JSON but no SVG (charts.js)
 *   7. text      tidy every text element and table cell, add the table
 *                stylesheet, the list variables and the bullet stylesheet,
 *                mark the deck with the current format (App.DECK_FORMAT)
 *
 * The result is { html, report }. The report lists everything that was found,
 * converted or removed, and dialogs.js shows it to the user.
 *
 * Talks to: normalize.js, charts.js, text.js, tables.js, fileio.js (calls importDeck),
 *           dialogs.js (shows the report), deck.js (removeRemoteRefs).
 */

(function () {
    'use strict';

    App.importer = {};

    // ---------------------------------------------------------------
    // 1. Parse
    // ---------------------------------------------------------------

    /* DOMParser builds a Document from text without showing it or running its scripts. */
    App.importer.parseHtml = function parseHtml(text) {
        return new DOMParser().parseFromString(text, 'text/html');
    };

    // ---------------------------------------------------------------
    // 2. Sanitize
    // ---------------------------------------------------------------

    function shorten(text, maxLength) {
        const singleLine = text.replace(/\s+/g, ' ').trim();
        return singleLine.length > maxLength ? singleLine.slice(0, maxLength) + '…' : singleLine;
    }

    function describeScript(script) {
        const src = script.getAttribute('src');
        if (src) {
            return 'External script: ' + src;
        }
        const code = script.textContent;
        return 'Inline script (' + App.util.formatBytes(code.length) + '): ' + shorten(code, 60);
    }

    // JSON data scripts (charts) are data, not code, and never run.
    function isDataScript(script) {
        const type = (script.getAttribute('type') || '').toLowerCase();
        return type === 'application/json' || type === 'application/ld+json';
    }

    // The player (src/player/player.js) marks the page with "deck-player-*"
    // classes and a --deck-player-scale variable at runtime.
    function removePlayerRuntimeMarks(doc) {
        doc.querySelectorAll('[class*="deck-player-"]').forEach((element) => {
            const kept = Array.from(element.classList).filter((name) => !name.startsWith('deck-player-'));
            if (kept.length) {
                element.setAttribute('class', kept.join(' '));
            } else {
                element.removeAttribute('class');
            }
        });
        const root = doc.documentElement;
        root.style.removeProperty('--deck-player-scale');
        if (root.getAttribute('style') === '') {
            root.removeAttribute('style');
        }
    }

    /*
     * Remove everything that could run code or load another page.
     * Returns { scripts: [{label}], handlers: number, other: [string] }.
     */
    App.importer.sanitize = function sanitize(doc) {
        const result = { scripts: [], handlers: 0, other: [] };

        // Our own player and its style are re-added on save, so drop them silently,
        // together with anything the player adds while it runs.
        doc.querySelectorAll('[data-deck-player], .deck-player-counter').forEach((node) => node.remove());
        removePlayerRuntimeMarks(doc);

        doc.querySelectorAll('script').forEach((script) => {
            if (isDataScript(script)) {
                return;
            }
            result.scripts.push({ label: describeScript(script) });
            script.remove();
        });

        const otherSelectors = [
            ['base', 'Base URL (<base>)'],
            ['meta[http-equiv]', 'Meta http-equiv'],
            ['iframe', 'Embedded page (<iframe>)'],
            ['frame', 'Embedded page (<frame>)'],
            ['object', 'Embedded object (<object>)'],
            ['embed', 'Embedded object (<embed>)'],
        ];
        // Harmless http-equiv values (the charset is re-declared on save anyway).
        const harmlessMeta = ['content-type', 'x-ua-compatible'];
        otherSelectors.forEach(([selector, label]) => {
            doc.querySelectorAll(selector).forEach((node) => {
                const httpEquiv = (node.getAttribute('http-equiv') || '').toLowerCase();
                if (harmlessMeta.indexOf(httpEquiv) !== -1) {
                    return;
                }
                const detail = node.getAttribute('src') || node.getAttribute('data') ||
                    node.getAttribute('http-equiv') || node.getAttribute('href') || '';
                result.other.push(label + (detail ? ': ' + detail : ''));
                node.remove();
            });
        });

        doc.querySelectorAll('*').forEach((element) => {
            Array.from(element.attributes).forEach((attribute) => {
                const name = attribute.name.toLowerCase();
                const isHandler = name.startsWith('on');
                const isJsLink = (name === 'href' || name === 'src' || name === 'action') &&
                    /^\s*javascript:/i.test(attribute.value);
                if (isHandler || isJsLink) {
                    element.removeAttribute(attribute.name);
                    result.handlers += 1;
                }
            });
        });

        return result;
    };

    // ---------------------------------------------------------------
    // 3. External references
    // ---------------------------------------------------------------

    const REMOTE_URL_RE = /^\s*(https?:)?\/\//i;
    const URL_IN_CSS_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    const IMPORT_RE = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?[^;]*;/gi;
    const FONT_FACE_RE = /@font-face\s*\{[^}]*\}/gi;

    function isRemote(url) {
        return REMOTE_URL_RE.test(url);
    }

    // data: and blob: are inline; '#...' is a link inside the page; about: is harmless.
    function isLocalFile(url) {
        const trimmed = url.trim();
        return trimmed !== '' && !isRemote(trimmed) && !/^(data:|blob:|#|about:)/i.test(trimmed);
    }

    function classify(url, kind, lists) {
        if (isRemote(url)) {
            lists.remote.push({ kind: kind, url: url.trim() });
        } else if (isLocalFile(url)) {
            lists.local.push({ kind: kind, url: url.trim() });
        }
    }

    /*
     * Scan CSS text and return references in the order they appear:
     * [{ kind: 'import' | 'font' | 'css-url', url, start, end }]
     */
    function cssReferences(cssText) {
        const found = [];
        const covered = [];   // ranges already reported as @import or @font-face

        cssText.replace(IMPORT_RE, (match, quote, url, offset) => {
            found.push({ kind: 'import', url: url, start: offset, end: offset + match.length });
            covered.push([offset, offset + match.length]);
            return match;
        });
        cssText.replace(FONT_FACE_RE, (block, offset) => {
            covered.push([offset, offset + block.length]);
            block.replace(URL_IN_CSS_RE, (match, quote, url) => {
                found.push({ kind: 'font', url: url, start: offset, end: offset + block.length });
                return match;
            });
            return block;
        });
        cssText.replace(URL_IN_CSS_RE, (match, quote, url, offset) => {
            const inside = covered.some(([from, to]) => offset >= from && offset < to);
            if (!inside) {
                found.push({ kind: 'css-url', url: url, start: offset, end: offset + match.length });
            }
            return match;
        });

        return found.sort((a, b) => a.start - b.start);
    }

    /*
     * List every reference to a file outside the deck.
     * Returns { remote: [{kind, url}], local: [{kind, url}] }.
     */
    App.importer.findExternalRefs = function findExternalRefs(doc) {
        const lists = { remote: [], local: [] };

        doc.querySelectorAll('link, style, img, [style]').forEach((node) => {
            const tag = node.tagName.toLowerCase();
            if (tag === 'link') {
                const rel = (node.getAttribute('rel') || '').toLowerCase();
                if (rel.indexOf('stylesheet') !== -1 || rel.indexOf('preload') !== -1) {
                    classify(node.getAttribute('href') || '', 'stylesheet', lists);
                }
            } else if (tag === 'style') {
                cssReferences(node.textContent).forEach((ref) => classify(ref.url, ref.kind, lists));
            } else if (tag === 'img') {
                classify(node.getAttribute('src') || '', 'image', lists);
            }
            if (tag !== 'style' && node.hasAttribute('style')) {
                cssReferences(node.getAttribute('style')).forEach((ref) => classify(ref.url, ref.kind, lists));
            }
        });

        return lists;
    };

    /* A small grey picture used where a blocked remote image used to be. */
    const BLOCKED_IMAGE_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90">' +
        '<rect width="160" height="90" fill="#eceef1"/>' +
        '<text x="80" y="50" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="#666">' +
        'image removed</text></svg>'
    );

    // Remove remote @import / @font-face rules and turn remote url(...) into "none".
    function stripRemoteCss(cssText, counter) {
        let text = cssText.replace(IMPORT_RE, (match, quote, url) => {
            if (!isRemote(url)) {
                return match;
            }
            counter.count += 1;
            return '';
        });
        text = text.replace(FONT_FACE_RE, (block) => {
            const hasRemote = cssReferences(block).some((ref) => isRemote(ref.url));
            if (!hasRemote) {
                return block;
            }
            counter.count += 1;
            return '';
        });
        return text.replace(URL_IN_CSS_RE, (match, quote, url) => {
            if (!isRemote(url)) {
                return match;
            }
            counter.count += 1;
            return 'none';
        });
    }

    /*
     * Remove what findExternalRefs(doc).remote lists. Remote images are replaced
     * by a placeholder picture, so the slide keeps its layout.
     * Returns how many references were removed.
     */
    App.importer.removeRemoteRefs = function removeRemoteRefs(doc) {
        const counter = { count: 0 };

        doc.querySelectorAll('link').forEach((link) => {
            if (isRemote(link.getAttribute('href') || '')) {
                link.remove();
                counter.count += 1;
            }
        });
        doc.querySelectorAll('style').forEach((style) => {
            const cleaned = stripRemoteCss(style.textContent, counter);
            if (cleaned !== style.textContent) {
                style.textContent = cleaned;
            }
        });
        doc.querySelectorAll('img').forEach((img) => {
            if (isRemote(img.getAttribute('src') || '')) {
                img.setAttribute('src', BLOCKED_IMAGE_PLACEHOLDER);
                counter.count += 1;
            }
        });
        doc.querySelectorAll('[style]').forEach((node) => {
            const before = node.getAttribute('style');
            const after = stripRemoteCss(before, counter);
            if (after !== before) {
                node.setAttribute('style', after);
            }
        });

        return counter.count;
    };

    // ---------------------------------------------------------------
    // 4. Detect slides
    // ---------------------------------------------------------------

    function isInsideMasterOrNotes(element) {
        return !!element.closest('.master, aside.notes, .notes');
    }

    /*
     * From a list of candidate elements keep the real slides:
     *  - drop wrappers that contain two or more other candidates (".slides")
     *  - then drop candidates inside another kept candidate (".slide-title")
     */
    function pickSlides(candidates) {
        const notWrappers = candidates.filter((candidate) => {
            const inner = candidates.filter((other) => other !== candidate && candidate.contains(other));
            return inner.length < 2;
        });
        return notWrappers.filter((candidate) => {
            return !notWrappers.some((other) => other !== candidate && other.contains(candidate));
        });
    }

    function hasSlideClass(element) {
        return /slide/i.test(element.getAttribute('class') || '');
    }

    /*
     * Find the slides using the rules from SPEC 3.4, in priority order:
     * section.slide, then section, then any class containing "slide".
     * The last rule (large 16:9 blocks) needs real layout, so normalize.js
     * applies it when this returns no slides.
     * Returns { slides: Element[], method: string | null }.
     */
    App.importer.detectSlides = function detectSlides(doc) {
        const body = doc.body;
        const rules = [
            ['section.slide', () => Array.from(body.querySelectorAll('section.slide'))],
            ['section', () => Array.from(body.querySelectorAll('section'))],
            ['class', () => Array.from(body.querySelectorAll('[class]')).filter(hasSlideClass)],
        ];

        for (const [method, findCandidates] of rules) {
            const candidates = findCandidates().filter((el) => !isInsideMasterOrNotes(el));
            const slides = pickSlides(candidates);
            if (slides.length > 0) {
                return { slides: slides, method: method };
            }
        }
        return { slides: [], method: null };
    };

    // ---------------------------------------------------------------
    // Putting it together
    // ---------------------------------------------------------------

    function newReport() {
        return {
            method: null,             // which slide-detection rule matched
            slideCount: 0,
            isContract: false,        // already in the editor's format?
            elementsConverted: 0,     // elements created by normalization
            scaledFrom: null,         // e.g. "1920×1080" when the deck was resized
            scriptsRemoved: [],       // [{ label }]
            handlersRemoved: 0,       // onclick=..., javascript: links
            otherRemoved: [],         // iframes, canvases drawn by scripts ...
            remoteRefs: [],           // [{ kind, url }] blocked by the browser
            localRefs: [],            // [{ kind, url }] files next to the deck we cannot read
            chartsRendered: 0,
            textConverted: 0,         // text elements converted to the text model (Phase 3)
            tablesConverted: 0,       // tables converted to the table model (Phase 4)
            fixes: [],                // small repairs on contract decks (missing ids ...)
            warnings: [],
        };
    }

    function ensureDeckFormatMeta(doc) {
        let meta = doc.head.querySelector('meta[name="deck-format"]');
        if (!meta) {
            meta = doc.createElement('meta');
            meta.setAttribute('name', 'deck-format');
            doc.head.prepend(meta);
        }
        meta.setAttribute('content', String(App.DECK_FORMAT));
    }

    /*
     * Every table cell is text in the text model (tables.js), and the deck carries
     * the current table stylesheet, after the deck's own CSS (whose generic
     * "td { … }" rules it must beat) and before the bullet stylesheet.
     */
    function finishTables(doc) {
        doc.querySelectorAll(App.tables.CELL_SELECTOR).forEach((cell) => App.text.normalizeCell(cell));
        doc.head.querySelectorAll('style[data-deck-table]').forEach((old) => old.remove());
        const style = doc.createElement('style');
        style.setAttribute('data-deck-table', '');
        style.textContent = App.tables.deckTableCss();
        doc.head.appendChild(style);
    }

    /*
     * Every deck leaves the importer in the text model (SPEC Phase 3): text is
     * tidied by the normalizer (it was converted already if the deck was older),
     * the list theme variables come first in <head> so the deck's own CSS can
     * override them, and the bullet stylesheet comes last, always the current one.
     */
    function finishTextModel(doc) {
        doc.querySelectorAll('.el[data-type="text"]').forEach((element) => App.text.normalize(element));

        let lists = doc.head.querySelector('style[data-deck-lists]');
        if (!lists) {
            lists = doc.createElement('style');
            lists.setAttribute('data-deck-lists', '');
            lists.textContent = ':root {\n' + App.text.themeVariablesCss() + '\n}\n';
        }
        const firstStyle = doc.head.querySelector('style, link[rel~="stylesheet"]');
        if (firstStyle !== lists) {
            doc.head.insertBefore(lists, firstStyle);
        }

        doc.head.querySelectorAll('style[data-deck-text]').forEach((old) => old.remove());
        const text = doc.createElement('style');
        text.setAttribute('data-deck-text', '');
        text.textContent = App.text.deckTextCss();
        doc.head.appendChild(text);
    }

    /*
     * Import a deck from its HTML text. `async` because measuring the layout
     * means waiting for a hidden iframe to load (see normalize.js).
     * Returns { html, report }.
     */
    App.importer.importDeck = async function importDeck(text) {
        const report = newReport();
        const doc = App.importer.parseHtml(text);

        const sanitized = App.importer.sanitize(doc);
        report.scriptsRemoved = sanitized.scripts;
        report.handlersRemoved = sanitized.handlers;
        report.otherRemoved = sanitized.other;

        const refs = App.importer.findExternalRefs(doc);
        report.remoteRefs = refs.remote;
        report.localRefs = refs.local;

        const detected = App.importer.detectSlides(doc);
        const deckDoc = await App.normalize.run(doc, detected, report);

        report.chartsRendered = App.charts.renderMissing(deckDoc);
        finishTables(deckDoc);
        finishTextModel(deckDoc);
        ensureDeckFormatMeta(deckDoc);

        return { html: '<!DOCTYPE html>\n' + deckDoc.documentElement.outerHTML, report: report };
    };

    /*
     * True when the import changed something the user should know about
     * (used to decide whether to show the report and mark the deck unsaved).
     */
    App.importer.reportHasChanges = function reportHasChanges(report) {
        return !report.isContract || report.fixes.length > 0 || report.scriptsRemoved.length > 0 ||
            report.handlersRemoved > 0 || report.otherRemoved.length > 0 || report.chartsRendered > 0 ||
            report.textConverted > 0 || report.tablesConverted > 0;
    };

    App.importer.reportHasItems = function reportHasItems(report) {
        return App.importer.reportHasChanges(report) || report.remoteRefs.length > 0 ||
            report.localRefs.length > 0 || report.warnings.length > 0;
    };
})();
