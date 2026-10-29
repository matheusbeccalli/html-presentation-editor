/*
 * text.js - the only door to the text inside text elements (SPEC 3.7, Phase 3).
 *
 * The text model ("flat paragraphs with levels"): inside a text element every
 * line is one <p>; its list type and indent level are attributes, not nested
 * HTML, exactly like a PowerPoint paragraph:
 *
 *     <p data-list="bullet|number|none" data-level="1..5" [data-start="N"]>…</p>
 *
 * Bullets and numbers are drawn by CSS (::before + counters) from the
 * <style data-deck-text> stylesheet (deckTextCss), which is part of the deck,
 * so a saved deck shows and prints them without the editor.
 *
 * normalize(element) is the defence against messy HTML (browser editing,
 * paste, import): it rewrites everything inside a text element into the
 * allowed set and is idempotent (running it twice = running it once).
 *
 * fromRendered(source, target) converts text that the browser has laid out
 * (the importer's measuring iframe) into the model, keeping its look: what is
 * the same for the whole box goes on the text element, the rest becomes inline
 * formatting; theme fonts/colours become var(--…).
 *
 * Editing: enterEdit / exitEdit make a text element contenteditable inside
 * the deck iframe; typing becomes history steps that remember the cursor
 * (getCaret / setCaret as line + character). Still to come in Phase 3:
 * applyStyle, setLevel, toggleList.
 *
 * Talks to: normalize.js and importer.js (import), history.js (typing steps),
 *           selection.js (selected box), commands.js (undo/redo while typing).
 */

(function () {
    'use strict';

    App.text = {};

    const MAX_LEVEL = 5;
    const LIST_TYPES = ['bullet', 'number', 'none'];

    // Per-level list theme (SPEC 3.3). A deck can override any of these with
    // the CSS variables --list-N-bullet, --list-N-number, --list-N-indent …
    App.text.LIST_DEFAULTS = [
        { bullet: '•', number: 'decimal', indent: '24px', spaceBefore: '6pt' },
        { bullet: '–', number: 'lower-alpha', indent: '56px', spaceBefore: '3pt' },
        { bullet: '▪', number: 'lower-roman', indent: '88px', spaceBefore: '3pt' },
        { bullet: '·', number: 'decimal', indent: '120px', spaceBefore: '3pt' },
        { bullet: '·', number: 'lower-alpha', indent: '152px', spaceBefore: '3pt' },
    ];

    // ---------------------------------------------------------------
    // Theme variables and the list stylesheet
    // ---------------------------------------------------------------

    /*
     * The --list-N-… declarations with their defaults, to put inside the deck's
     * :root rule. --list-N-bullet-color and --list-N-bullet-size are left unset:
     * unset means "follow the line's first character" (like PowerPoint); a
     * template may set them to a fixed colour or a size relative to the text.
     */
    App.text.themeVariablesCss = function themeVariablesCss() {
        return App.text.LIST_DEFAULTS.map((d, index) => {
            const n = index + 1;
            return '--list-' + n + '-bullet: "' + d.bullet + '"; --list-' + n + '-number: ' + d.number + '; ' +
                '--list-' + n + '-indent: ' + d.indent + '; --list-' + n + '-space-before: ' + d.spaceBefore + ';';
        }).join('\n');
    };

    function themeVar(n, name) {
        const d = App.text.LIST_DEFAULTS[n - 1];
        // The bullet follows the first character: --marker-size/--marker-color, which
        // normalize() writes on each line, else the line's own size and colour.
        const fallback = { bullet: '"' + d.bullet + '"', number: d.number, indent: d.indent,
            'space-before': d.spaceBefore, 'bullet-color': 'var(--marker-color, currentColor)',
            'bullet-size': 'var(--marker-size, 1em)' }[name];
        // The fallback keeps the deck readable even if its :root lacks the variables.
        return 'var(--list-' + n + '-' + name + ', ' + fallback + ')';
    }

    // "list-3 0 list-4 0 list-5 0": the counters from level `from` down, set back to zero.
    function resetCounters(from) {
        const parts = [];
        for (let n = from; n <= MAX_LEVEL; n++) {
            parts.push('list-' + n + ' 0');
        }
        return parts.join(' ');
    }

    /*
     * The <style data-deck-text> stylesheet. How numbering works with flat
     * paragraphs: each text element starts counters list-1 … list-5. A numbered
     * paragraph at level N counts on list-N and zeroes the deeper counters
     * (1, 2, a, b, 3); a bulleted or plain paragraph at level N zeroes list-N
     * and deeper, which ends the numbered run. CSS applies counter-set after
     * counter-increment, so data-start="N" becomes an inline "counter-set: list-L N".
     */
    App.text.deckTextCss = function deckTextCss() {
        const rules = [
            '/* Bullets, numbers and indents of the text model (written by the editor). */',
            '.el { counter-reset: list-1 list-2 list-3 list-4 list-5; }',
            // A line's look comes only from its text box and its inline formatting, so a
            // deck's own rules for <p> (".el p { font-size: 14px }") cannot restyle it.
            '.el p[data-list][data-level] { font: inherit; color: inherit; letter-spacing: inherit;' +
            ' text-transform: inherit; text-align: inherit; text-indent: 0; margin: 0; padding: 0;' +
            ' border: 0; background: none; }',
        ];
        for (let n = 1; n <= MAX_LEVEL; n++) {
            const level = '[data-level="' + n + '"]';
            const bullet = '.el p[data-list="bullet"]' + level;
            const number = '.el p[data-list="number"]' + level;
            const plain = '.el p[data-list="none"]' + level;
            const hang = n === 1
                ? themeVar(1, 'indent')
                : 'calc(' + themeVar(n, 'indent') + ' - ' + themeVar(n - 1, 'indent') + ')';

            // Text indent: list lines always; plain lines from level 2, aligned with the list text.
            rules.push(bullet + ', ' + number + (n > 1 ? ', ' + plain : '') +
                ' { padding-left: ' + themeVar(n, 'indent') + '; }');
            rules.push(bullet + ', ' + number + ' { margin-top: ' + themeVar(n, 'space-before') + '; }');

            rules.push(number + ' { counter-increment: list-' + n + ';' +
                (n < MAX_LEVEL ? ' counter-set: ' + resetCounters(n + 1) + ';' : '') + ' }');
            rules.push(bullet + ', ' + plain + ' { counter-set: ' + resetCounters(n) + '; }');

            // The bullet/number hangs in the indent, so wrapped lines align with the text.
            rules.push(bullet + '::before, ' + number + '::before { display: inline-block; width: ' + hang +
                '; margin-left: calc(-1 * ' + hang + '); color: ' + themeVar(n, 'bullet-color') +
                '; font-size: ' + themeVar(n, 'bullet-size') + '; }');
            rules.push(bullet + '::before { content: ' + themeVar(n, 'bullet') + '; }');
            rules.push(number + '::before { content: counter(list-' + n + ', ' + themeVar(n, 'number') + ') "."; }');
        }
        // Like PowerPoint, the first line of a text box gets no space above it.
        rules.push('.el p[data-list]:first-child { margin-top: 0; }');
        return rules.join('\n') + '\n';
    };

    // ---------------------------------------------------------------
    // Reading attributes and styles
    // ---------------------------------------------------------------

    const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'blockquote',
        'pre', 'section', 'article', 'header', 'footer', 'aside', 'nav', 'main', 'figure', 'figcaption',
        'dl', 'dt', 'dd', 'address', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption']);
    const BLOCK_SELECTOR = Array.from(BLOCK_TAGS).join(',');

    // Removed together with everything inside them.
    const DROP_TAGS = new Set(['script', 'style', 'template', 'noscript', 'meta', 'link', 'title', 'head',
        'iframe', 'object', 'embed', 'svg', 'math', 'img', 'picture', 'video', 'audio', 'canvas', 'input',
        'select', 'textarea', 'hr']);

    // Inline tags that map to an allowed formatting tag.
    const TAG_FORMATS = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', ins: 'u', s: 's', strike: 's', del: 's',
        sup: 'sup', sub: 'sub' };
    const FORMAT_TAGS = ['b', 'i', 'u', 's', 'sup', 'sub'];

    const THEME_FONT_RE = /^var\(--font-(heading|body)\)$/;
    const THEME_COLOR_RE = /^var\(--color-[a-z0-9-]+\)$/;
    const SAFE_LINK_RE = /^\s*(https?:|mailto:)/i;
    const ALIGNMENTS = ['left', 'center', 'right', 'justify'];
    const CSS_KEYWORDS = ['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'currentcolor'];

    function tagOf(node) {
        return node.nodeType === Node.ELEMENT_NODE ? node.localName.toLowerCase() : '';
    }

    function isBlock(node) {
        return BLOCK_TAGS.has(tagOf(node));
    }

    function containsBlock(element) {
        return element.querySelector(BLOCK_SELECTOR) !== null;
    }

    function clampLevel(value) {
        const level = parseInt(value, 10);
        if (isNaN(level) || level < 1) {
            return 1;
        }
        return Math.min(level, MAX_LEVEL);
    }

    function positiveInt(value) {
        const number = parseInt(value, 10);
        return String(number) === String(value).trim() && number >= 1 ? number : null;
    }

    function isPlainValue(value) {
        return value !== '' && CSS_KEYWORDS.indexOf(value.toLowerCase()) === -1;
    }

    /* "24pt" from px or pt (1 pt = 96/72 px), rounded to half points; null for anything else. */
    function toPoints(value) {
        const match = /^(\d+(?:\.\d+)?)(px|pt)$/.exec(value.trim());
        if (!match) {
            return null;
        }
        const points = match[2] === 'px' ? parseFloat(match[1]) * 0.75 : parseFloat(match[1]);
        return String(Math.round(points * 2) / 2) + 'pt';
    }

    function allowedColor(value) {
        if (value.indexOf('var(') !== -1) {
            return THEME_COLOR_RE.test(value) ? value : null;
        }
        return isPlainValue(value) ? value : null;
    }

    /* The allowed span styles of an element, as { property: value } (only those present). */
    function spanStyles(element) {
        const style = element.style;
        const result = {};
        const family = style ? style.getPropertyValue('font-family') : '';
        if (family && (family.indexOf('var(') === -1 ? isPlainValue(family) : THEME_FONT_RE.test(family))) {
            result['font-family'] = family;
        }
        const size = style ? toPoints(style.getPropertyValue('font-size')) : null;
        if (size) {
            result['font-size'] = size;
        }
        const color = style ? allowedColor(style.getPropertyValue('color')) : null;
        if (color) {
            result.color = color;
        }
        const background = style ? allowedColor(style.getPropertyValue('background-color')) : null;
        if (background && background !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(background)) {
            result['background-color'] = background;
        }
        return result;
    }

    /* Old <font face color> becomes span styles. */
    function fontTagStyles(element) {
        const holder = element.ownerDocument.createElement('span');
        if (element.getAttribute('face')) {
            holder.style.setProperty('font-family', element.getAttribute('face'));
        }
        if (element.getAttribute('color')) {
            holder.style.setProperty('color', element.getAttribute('color'));
        }
        return spanStyles(holder);
    }

    /* Formatting written as style (font-weight: bold …) becomes formatting tags. */
    function styleFormats(element) {
        const style = element.style;
        if (!style) {
            return [];
        }
        const formats = [];
        const weight = style.getPropertyValue('font-weight');
        if (weight === 'bold' || weight === 'bolder' || parseInt(weight, 10) >= 600) {
            formats.push('b');
        }
        if (/italic|oblique/.test(style.getPropertyValue('font-style'))) {
            formats.push('i');
        }
        const decoration = style.getPropertyValue('text-decoration-line') || style.getPropertyValue('text-decoration');
        if (/underline/.test(decoration)) {
            formats.push('u');
        }
        if (/line-through/.test(decoration)) {
            formats.push('s');
        }
        const vertical = style.getPropertyValue('vertical-align');
        if (vertical === 'super') {
            formats.push('sup');
        } else if (vertical === 'sub') {
            formats.push('sub');
        }
        return formats;
    }

    /* The allowed paragraph styles of a block: alignment, line height, spacing. */
    function paragraphStyles(element) {
        const style = element.style;
        const result = {};
        if (!style) {
            return result;
        }
        const align = style.getPropertyValue('text-align');
        if (ALIGNMENTS.indexOf(align) !== -1) {
            result['text-align'] = align;
        }
        ['line-height', 'margin-top', 'margin-bottom'].forEach((property) => {
            const value = style.getPropertyValue(property);
            if (value && isPlainValue(value) && value.indexOf('var(') === -1) {
                result[property] = value;
            }
        });
        return result;
    }

    function styleText(styles, order) {
        return order.filter((property) => styles[property])
            .map((property) => property + ': ' + styles[property] + ';').join(' ');
    }

    const SPAN_ORDER = ['font-family', 'font-size', 'color', 'background-color'];
    const PARAGRAPH_ORDER = ['text-align', 'line-height', 'margin-top', 'margin-bottom', 'counter-set',
        'font-size', 'color', '--marker-size', '--marker-color'];

    // ---------------------------------------------------------------
    // Normalizer, phase 1: find the paragraphs
    // ---------------------------------------------------------------

    /*
     * Walks the element and returns paragraph records:
     *   { list, level, start, pStyle, wrappers, fill, nodes }
     * nodes = the inline content (original nodes, cleaned later); wrappers =
     * formatting tags that surrounded the paragraph (an <i> around several
     * blocks, a heading's bold); fill = span styles of the blocks around it
     * (a heading's size and colour, or what an empty line kept), given to the
     * text that has no such style of its own.
     */
    function collectParagraphs(element) {
        const out = [];
        collectChildren(element, { para: null, listDepth: 0, wrappers: [], fill: {}, pStyle: {} }, out);
        return out;
    }

    function collectChildren(parent, ctx, out) {
        let run = [];
        const flush = () => {
            const meaningful = run.some((node) => node.nodeType === Node.ELEMENT_NODE
                ? node.textContent.trim() !== '' || tagOf(node) === 'br' || node.querySelector('br')
                : node.textContent.trim() !== '');
            if (meaningful) {
                out.push(makeRecord(ctx, run));
            }
            run = [];
        };
        Array.from(parent.childNodes).forEach((child) => {
            if (child.nodeType === Node.COMMENT_NODE || DROP_TAGS.has(tagOf(child))) {
                return;
            }
            if (isBlock(child)) {
                flush();
                collectBlock(child, ctx, out);
            } else if (child.nodeType === Node.ELEMENT_NODE && containsBlock(child)) {
                // An inline element around blocks (<b><p>…</p><p>…</p></b>): its
                // formatting reaches every paragraph inside.
                flush();
                collectChildren(child, Object.assign({}, ctx, { wrappers: ctx.wrappers.concat([child.cloneNode(false)]) }), out);
            } else {
                run.push(child);
            }
        });
        flush();
    }

    function makeRecord(ctx, nodes) {
        const para = ctx.para || { list: 'none', level: 1, start: null };
        const record = {
            list: para.list, level: para.level, start: para.start,
            pStyle: ctx.pStyle, wrappers: ctx.wrappers, fill: ctx.fill, nodes: nodes,
        };
        if (ctx.para) {
            ctx.para.start = null;   // a start number belongs to the first line only
        }
        return record;
    }

    /*
     * A block's look (a heading's size, colour, bold …), carried into its text:
     * formatting tags wrap the paragraph; span styles fill in the text that has
     * none of its own. On a model <p>, a real font-size/color was derived by an
     * earlier normalize (an empty line, or a line all in one size), so text
     * typed into it later keeps that look.
     */
    function blockLook(block, ctx) {
        const doc = block.ownerDocument;
        return {
            wrappers: ctx.wrappers.concat(styleFormats(block).map((format) => doc.createElement(format))),
            fill: Object.assign({}, ctx.fill, spanStyles(block)),
        };
    }

    function collectBlock(block, ctx, out) {
        const tag = tagOf(block);
        if (tag === 'ul' || tag === 'ol') {
            collectList(block, ctx, out);
            return;
        }
        const isModel = block.hasAttribute('data-list') || block.hasAttribute('data-level');
        let para;
        if (isModel) {
            const list = LIST_TYPES.indexOf(block.getAttribute('data-list')) !== -1 ? block.getAttribute('data-list') : 'none';
            const start = list === 'number' ? positiveInt(block.getAttribute('data-start')) : null;
            para = { list: list, level: clampLevel(block.getAttribute('data-level')), start: start };
        } else if (tag === 'li') {
            para = ctx.para || { list: 'bullet', level: Math.max(1, ctx.listDepth), start: null };
        } else {
            para = ctx.para;
        }
        const own = paragraphStyles(block);
        const look = blockLook(block, ctx);
        const inner = {
            para: para,
            listDepth: ctx.listDepth,
            wrappers: look.wrappers,
            fill: look.fill,
            pStyle: Object.assign({}, ctx.pStyle, withoutMargins(own)),
        };
        const before = out.length;
        collectChildren(block, inner, out);
        if (out.length === before) {
            // An empty block is an empty line (as the browser showed it).
            out.push(makeRecord(inner, []));
        }
        applyBlockMargins(own, out, before);
    }

    function withoutMargins(styles) {
        const result = Object.assign({}, styles);
        delete result['margin-top'];
        delete result['margin-bottom'];
        return result;
    }

    /*
     * A block's top margin belongs to the first line it produced and its bottom
     * margin to the last one, never to every nested line. Where a nested line
     * has its own margin too, the larger wins (as margins collapse in the browser).
     */
    function applyBlockMargins(own, out, before) {
        if (out.length === before) {
            return;
        }
        [['margin-top', out[before]], ['margin-bottom', out[out.length - 1]]].forEach(([property, record]) => {
            if (!own[property]) {
                return;
            }
            const current = record.pStyle[property];
            const larger = current && parseFloat(current) > parseFloat(own[property]) ? current : own[property];
            record.pStyle = Object.assign({}, record.pStyle, { [property]: larger });
        });
    }

    function collectList(list, ctx, out) {
        const level = Math.min(ctx.listDepth + 1, MAX_LEVEL);
        const isOrdered = tagOf(list) === 'ol';
        const listType = /none/.test(list.style.getPropertyValue('list-style-type')) ? 'none'
            : isOrdered ? 'number' : 'bullet';
        // The list's own look (size, colour …) reaches every item; its margins do not.
        const listLook = blockLook(list, ctx);
        const ownStyle = paragraphStyles(list);
        const listStyle = Object.assign({}, ctx.pStyle);
        ['text-align', 'line-height'].forEach((property) => {
            if (ownStyle[property]) {
                listStyle[property] = ownStyle[property];
            }
        });
        let first = true;
        const before = out.length;
        Array.from(list.childNodes).forEach((child) => {
            if (child.nodeType === Node.COMMENT_NODE || DROP_TAGS.has(tagOf(child))) {
                return;
            }
            if (tagOf(child) !== 'li') {
                if (isBlock(child)) {
                    collectBlock(child, Object.assign({}, ctx, { listDepth: level }), out);
                } else if (child.textContent.trim() !== '') {
                    out.push(makeRecord(Object.assign({}, ctx, { para: { list: listType, level: level, start: null } }), [child]));
                }
                return;
            }
            let start = listType === 'number' ? positiveInt(child.getAttribute('value')) : null;
            if (first && listType === 'number' && start === null) {
                start = firstNumber(list, out, level);
            }
            first = false;
            const item = { para: { list: listType, level: level, start: start }, listDepth: level,
                wrappers: listLook.wrappers, fill: listLook.fill, pStyle: listStyle };
            collectBlock(child, item, out);
        });
        applyBlockMargins(ownStyle, out, before);
    }

    /*
     * data-start for the first item of an <ol>: its start attribute, or 1 when
     * the flat paragraphs before it would otherwise continue its numbering
     * (two <ol> in a row each start at 1 in the browser).
     */
    function firstNumber(list, out, level) {
        const start = positiveInt(list.getAttribute('start'));
        const continues = numberingContinues(out, level);
        if (start !== null && (start !== 1 || continues)) {
            return start;
        }
        return continues ? 1 : null;
    }

    function numberingContinues(out, level) {
        for (let i = out.length - 1; i >= 0; i--) {
            if (out[i].level < level) {
                return false;
            }
            if (out[i].level === level) {
                return out[i].list === 'number';
            }
        }
        return false;
    }

    // ---------------------------------------------------------------
    // Normalizer, phase 2: clean the inline content
    // ---------------------------------------------------------------

    /* One node -> a list of clean nodes (formatting converted, unknown tags unwrapped). */
    function cleanInline(node, doc) {
        if (node.nodeType === Node.TEXT_NODE) {
            return [doc.createTextNode(node.textContent)];
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return [];
        }
        const tag = tagOf(node);
        if (DROP_TAGS.has(tag)) {
            return [];
        }
        if (tag === 'br') {
            return [doc.createElement('br')];
        }
        let content = [];
        node.childNodes.forEach((child) => {
            content = content.concat(cleanInline(child, doc));
        });
        if (!hasContent(content)) {
            return [];   // empty formatting disappears
        }

        // Innermost first: sup/sub, s, u, i, b, then the span, then the link.
        const formats = styleFormats(node);
        if (TAG_FORMATS[tag]) {
            formats.unshift(TAG_FORMATS[tag]);
        }
        FORMAT_TAGS.slice().reverse().forEach((format) => {
            if (formats.indexOf(format) !== -1) {
                content = [wrap(doc.createElement(format), content)];
            }
        });
        const styles = tag === 'font' ? Object.assign(fontTagStyles(node), spanStyles(node)) : spanStyles(node);
        if (Object.keys(styles).length > 0) {
            const span = doc.createElement('span');
            span.setAttribute('style', styleText(styles, SPAN_ORDER));
            content = [wrap(span, content)];
        }
        if (tag === 'a' && SAFE_LINK_RE.test(node.getAttribute('href') || '')) {
            const link = doc.createElement('a');
            link.setAttribute('href', node.getAttribute('href').trim());
            content = [wrap(link, content)];
        }
        return content;
    }

    function wrap(wrapper, nodes) {
        nodes.forEach((node) => wrapper.appendChild(node));
        return wrapper;
    }

    function hasContent(nodes) {
        return nodes.some((node) => node.nodeType === Node.TEXT_NODE
            ? node.textContent !== ''
            : tagOf(node) === 'br' || node.textContent !== '' || node.querySelector('br'));
    }

    // ---------------------------------------------------------------
    // Normalizer, phase 3: tidy, whitespace, derived values
    // ---------------------------------------------------------------

    function signature(element) {
        return tagOf(element) + '|' + (element.getAttribute('style') || '') + '|' + (element.getAttribute('href') || '');
    }

    function unwrap(element) {
        while (element.firstChild) {
            element.parentNode.insertBefore(element.firstChild, element);
        }
        element.remove();
    }

    /* One tidy pass; returns true when it changed something (the caller repeats until stable). */
    function tidyPass(paragraph) {
        paragraph.normalize();   // DOM normalize: joins neighbouring text nodes, drops empty ones
        const elements = Array.from(paragraph.querySelectorAll('*'));
        for (const element of elements) {
            const tag = tagOf(element);
            if (tag === 'br') {
                continue;
            }
            if (!element.firstChild || !hasContent(Array.from(element.childNodes))) {
                element.remove();
                return true;
            }
            // Formatting inside the same formatting is redundant: <b>a<b>b</b></b>.
            const parent = element.parentElement;
            const redundant = tag === 'span'
                ? parent !== paragraph && signature(parent) === signature(element)
                : element.parentElement.closest(tag) !== null && paragraph.contains(element.parentElement.closest(tag));
            if (redundant) {
                unwrap(element);
                return true;
            }
            // Identical neighbours merge: <b>a</b><b>b</b> -> <b>ab</b>.
            const next = element.nextSibling;
            if (next && next.nodeType === Node.ELEMENT_NODE && signature(next) === signature(element)) {
                while (next.firstChild) {
                    element.appendChild(next.firstChild);
                }
                next.remove();
                return true;
            }
        }
        return false;
    }

    function tidy(paragraph) {
        while (tidyPass(paragraph)) {
            // repeat until nothing changes
        }
    }

    /* Text nodes and <br> of a paragraph in reading order. */
    function inlineItems(paragraph) {
        const items = [];
        const walker = paragraph.ownerDocument.createTreeWalker(paragraph, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
            if (node.nodeType === Node.TEXT_NODE || tagOf(node) === 'br') {
                items.push(node);
            }
            node = walker.nextNode();
        }
        return items;
    }

    /*
     * Pretty-printed source whitespace collapses to one space (as the browser
     * shows it) and is trimmed at the start and end of each line. Non-breaking
     * spaces ( ) are real content and stay.
     */
    function collapseWhitespace(paragraph) {
        const items = inlineItems(paragraph);
        let previous = null;   // the last text kept, or a <br>
        items.forEach((item, index) => {
            if (item.nodeType !== Node.TEXT_NODE) {
                previous = item;
                return;
            }
            let text = item.textContent.replace(/[ \t\n\r\f]+/g, ' ');
            const atLineStart = previous === null || previous.nodeType !== Node.TEXT_NODE;
            if (atLineStart || / $/.test(previous.textContent)) {
                text = text.replace(/^ /, '');
            }
            const nextItem = items.slice(index + 1).find((other) => other.nodeType !== Node.TEXT_NODE ||
                other.textContent.replace(/[ \t\n\r\f]+/g, '') !== '');
            if (!nextItem || nextItem.nodeType !== Node.TEXT_NODE) {
                text = text.replace(/ $/, '');
            }
            item.textContent = text;
            if (text !== '') {
                previous = item;
            }
        });
    }

    /* font-size and color from the spans around `node` (inside the paragraph), innermost first. */
    function spanLook(node, paragraph, look) {
        let current = node;
        while (current && current !== paragraph) {
            if (tagOf(current) === 'span') {
                look.size = look.size || current.style.getPropertyValue('font-size') || null;
                look.color = look.color || current.style.getPropertyValue('color') || null;
            }
            current = current.parentElement;
        }
        return look;
    }

    /*
     * Values the normalizer derives for the <p> itself:
     * - a line with text: --marker-size / --marker-color from its first
     *   character, read only by the bullet/number (SPEC: bullets follow the text);
     * - an empty line: a real font-size / color, so the line keeps its height
     *   and what is typed into it later starts with that look.
     */
    function derivedLook(paragraph, record) {
        const items = inlineItems(paragraph);
        const firstText = items.find((item) => item.nodeType === Node.TEXT_NODE && item.textContent !== '');
        if (firstText) {
            const look = spanLook(firstText.parentElement, paragraph, {});
            // A line all in one size also gets it as its own size: the line is then exactly as
            // tall as its text (otherwise the box's default size would set a minimum height).
            const sizes = items.filter((item) => item.nodeType === Node.TEXT_NODE && item.textContent.trim() !== '')
                .map((item) => spanLook(item.parentElement, paragraph, {}).size);
            const uniform = sizes.every((size) => size && size === sizes[0]) ? sizes[0] : null;
            return { 'font-size': uniform, '--marker-size': look.size, '--marker-color': look.color };
        }
        const look = items.length > 0 ? spanLook(items[0].parentElement, paragraph, {}) : {};
        // An empty line keeps the look of the blocks around it (its spans were dropped as empty).
        return { 'font-size': look.size || record.fill['font-size'], color: look.color || record.fill.color };
    }

    /*
     * Give span styles (`fill`) to the text that has none of its own: a span gets
     * the missing properties added, other formatting is wrapped whole when no span
     * inside it sets any of them. Equivalent to one span around everything (inner
     * spans win anyway), but without dead nested spans, so normalize stays idempotent.
     */
    function fillMissing(node, fill, doc) {
        Array.from(node.childNodes).forEach((child) => {
            const tag = tagOf(child);
            if (child.nodeType === Node.TEXT_NODE) {
                if (child.textContent !== '') {
                    wrapInSpan(child, fill, doc);
                }
            } else if (tag === 'span') {
                const own = spanStyles(child);
                child.setAttribute('style', styleText(Object.assign({}, fill, own), SPAN_ORDER));
            } else if (child.nodeType === Node.ELEMENT_NODE && tag !== 'br') {
                if (child.querySelector('span')) {
                    fillMissing(child, fill, doc);
                } else {
                    wrapInSpan(child, fill, doc);
                }
            }
        });
    }

    function wrapInSpan(node, styles, doc) {
        const span = doc.createElement('span');
        span.setAttribute('style', styleText(styles, SPAN_ORDER));
        node.replaceWith(span);
        span.appendChild(node);
    }

    function buildParagraph(record, doc) {
        const p = doc.createElement('p');
        p.setAttribute('data-list', record.list);
        p.setAttribute('data-level', String(record.level));
        if (record.start !== null) {
            p.setAttribute('data-start', String(record.start));
        }

        // Formatting from around the paragraph, then its own content, cleaned as one piece.
        // An empty line skips it: its look goes on the <p> (derivedLook).
        const holder = doc.createElement('div');
        let target = holder;
        const hasText = record.nodes.some((node) => node.textContent.replace(/[ \t\n\r\f]+/g, '') !== '');
        (hasText ? record.wrappers : []).forEach((wrapper) => {
            const copy = doc.importNode(wrapper, false);
            target.appendChild(copy);
            target = copy;
        });
        record.nodes.forEach((node) => target.appendChild(doc.importNode(node, true)));
        let content = [];
        holder.childNodes.forEach((child) => {
            content = content.concat(cleanInline(child, doc));
        });
        content.forEach((node) => p.appendChild(node));
        if (hasText && Object.keys(record.fill).length > 0) {
            fillMissing(p, record.fill, doc);
        }

        collapseWhitespace(p);
        tidy(p);
        if (!hasContent(Array.from(p.childNodes))) {
            p.replaceChildren(doc.createElement('br'));
        }

        const styles = Object.assign({}, record.pStyle);
        if (record.start !== null) {
            styles['counter-set'] = 'list-' + record.level + ' ' + record.start +
                (record.level < MAX_LEVEL ? ' ' + resetCounters(record.level + 1) : '');
        }
        const look = derivedLook(p, record);
        if (look['font-size'] && hasText) {
            // Spaces between the spans take the line's size too (the next normalize would do it anyway).
            fillMissing(p, { 'font-size': look['font-size'] }, doc);
            tidy(p);
        }
        Object.assign(styles, look);
        const text = styleText(styles, PARAGRAPH_ORDER);
        if (text) {
            p.setAttribute('style', text);
        }
        return p;
    }

    /*
     * Rewrite the HTML inside a text element into the allowed set (SPEC Phase 3,
     * "Normalizer"). The element's own attributes and style are not touched.
     */
    App.text.normalize = function normalize(element) {
        const doc = element.ownerDocument;
        const paragraphs = collectParagraphs(element).map((record) => buildParagraph(record, doc));
        element.replaceChildren(...paragraphs);
    };

    /*
     * The text as data: [{ list, level, start, text }] per paragraph; a <br>
     * inside a line is '\n' (a <br> that only keeps an empty line open is not).
     */
    App.text.getModel = function getModel(element) {
        return Array.from(element.children).filter((child) => tagOf(child) === 'p').map((p) => {
            const items = inlineItems(p);
            let text = items.map((item) => item.nodeType === Node.TEXT_NODE ? item.textContent : '\n').join('');
            if (items.length > 0 && items[items.length - 1].nodeType !== Node.TEXT_NODE) {
                text = text.slice(0, -1);
            }
            const list = p.getAttribute('data-list');
            return {
                list: LIST_TYPES.indexOf(list) !== -1 ? list : 'none',
                level: clampLevel(p.getAttribute('data-level')),
                start: list === 'number' ? positiveInt(p.getAttribute('data-start')) : null,
                text: text,
            };
        });
    };

    // ---------------------------------------------------------------
    // Converting rendered text into the model (import, format-1 decks)
    // ---------------------------------------------------------------

    // The look of a piece of text, read from the browser's computed style.
    const LOOK_PROPS = ['font-family', 'font-size', 'color', 'font-weight', 'font-style',
        'letter-spacing', 'text-transform', 'text-align', 'line-height'];

    function round2(value) {
        return String(Math.round(value * 100) / 100);
    }

    /*
     * The deck's theme fonts and colours ({ fonts: [{ name, value }], colors: [...] }),
     * as computed values, so text using them can be written back as var(--…).
     * --color-bg is left out: white text is not "the background colour".
     */
    const themeCache = new WeakMap();

    function themeValues(sourceDoc) {
        if (themeCache.has(sourceDoc)) {
            return themeCache.get(sourceDoc);
        }
        const names = [];
        Array.from(sourceDoc.styleSheets).forEach((sheet) => {
            let rules = [];
            try {
                rules = Array.from(sheet.cssRules || []);
            } catch (error) {
                return;   // a blocked remote stylesheet: the browser will not show its rules
            }
            rules.forEach((rule) => {
                if (rule.selectorText && /(^|,)\s*:root\s*($|,)/.test(rule.selectorText)) {
                    Array.from(rule.style).forEach((name) => {
                        if (/^--(font-(heading|body)|color-[a-z0-9-]+)$/.test(name) && !/^--color-(bg|background)/.test(name) &&
                            names.indexOf(name) === -1) {
                            names.push(name);
                        }
                    });
                }
            });
        });
        const probe = sourceDoc.createElement('span');
        sourceDoc.body.appendChild(probe);
        const view = sourceDoc.defaultView;
        const theme = { fonts: [], colors: [] };
        names.forEach((name) => {
            const isFont = name.indexOf('--font-') === 0;
            probe.style.cssText = (isFont ? 'font-family' : 'color') + ': var(' + name + ')';
            const computed = view.getComputedStyle(probe);
            (isFont ? theme.fonts : theme.colors).push({ name: name, value: isFont ? computed.fontFamily : computed.color });
        });
        probe.remove();
        themeCache.set(sourceDoc, theme);
        return theme;
    }

    /* var(--font-heading) / var(--font-body) for a theme font; headings prefer the heading font. */
    function themeFont(value, element, theme) {
        const matches = theme.fonts.filter((font) => font.value === value);
        if (matches.length === 0) {
            return value;
        }
        const wanted = element && element.closest('h1, h2, h3, h4, h5, h6') ? '--font-heading' : '--font-body';
        const chosen = matches.find((font) => font.name === wanted) || matches[0];
        return 'var(' + chosen.name + ')';
    }

    function themeColor(value, theme) {
        const match = theme.colors.find((color) => color.value === value);
        return match ? 'var(' + match.name + ')' : value;
    }

    /* Computed style -> look, with px sizes scaled to the 1280x720 slide and turned into pt. */
    function lookOf(computed, scale, element) {
        const theme = element ? themeValues(element.ownerDocument) : { fonts: [], colors: [] };
        const fontPx = parseFloat(computed.fontSize);
        const align = { start: 'left', end: 'right', '-webkit-center': 'center', '-webkit-left': 'left',
            '-webkit-right': 'right' }[computed.textAlign] || computed.textAlign;
        return {
            'font-family': themeFont(computed.fontFamily, element, theme),
            'font-size': toPoints(round2(fontPx * scale) + 'px'),
            color: themeColor(computed.color, theme),
            'font-weight': parseInt(computed.fontWeight, 10) >= 600 ? 'bold' : 'normal',
            'font-style': /italic|oblique/.test(computed.fontStyle) ? 'italic' : 'normal',
            'letter-spacing': computed.letterSpacing === 'normal' ? 'normal'
                : round2(parseFloat(computed.letterSpacing) * scale) + 'px',
            'text-transform': computed.textTransform,
            'text-align': align,
            'line-height': computed.lineHeight === 'normal' ? 'normal'
                : round2(parseFloat(computed.lineHeight) / fontPx),
        };
    }

    function isHidden(computed) {
        return computed.display === 'none' || computed.visibility === 'hidden';
    }

    /* Text nodes worth reading under `root` (not hidden, not inside dropped tags). */
    function visibleTextNodes(root) {
        const view = root.ownerDocument.defaultView;
        const nodes = [];
        const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const parent = node.parentElement;
            if (node.textContent.trim() === '' || !parent || parent.closest('script,style,svg,template') ||
                isHidden(view.getComputedStyle(parent))) {
                continue;
            }
            nodes.push(node);
        }
        return nodes;
    }

    /*
     * The look of the whole box: for each property, the value most of the text
     * has (weighted by length). That goes on the text element; only what
     * differs from it becomes inline formatting (SPEC 3.4).
     */
    function boxLook(textNodes, scale) {
        const view = textNodes[0].ownerDocument.defaultView;
        const votes = {};
        LOOK_PROPS.forEach((property) => { votes[property] = new Map(); });
        textNodes.forEach((node) => {
            const look = lookOf(view.getComputedStyle(node.parentElement), scale, node.parentElement);
            const weight = node.textContent.trim().length;
            LOOK_PROPS.forEach((property) => {
                const tally = votes[property];
                tally.set(look[property], (tally.get(look[property]) || 0) + weight);
            });
        });
        const result = {};
        LOOK_PROPS.forEach((property) => {
            let best = null;
            votes[property].forEach((count, value) => {
                if (best === null || count > votes[property].get(best)) {
                    best = value;
                }
            });
            result[property] = best;
        });
        return result;
    }

    function writeBoxLook(target, look) {
        LOOK_PROPS.forEach((property) => {
            if (look[property]) {
                target.style.setProperty(property, look[property]);
            }
        });
    }

    /*
     * A flex or grid text box (often used to centre a title vertically) becomes a
     * column of paragraphs that keeps the vertical alignment.
     */
    function keepVerticalAlignment(computed, target) {
        const display = computed.display;
        if (!/flex|grid/.test(display)) {
            return;
        }
        const isColumn = /flex/.test(display) && /column/.test(computed.flexDirection);
        const vertical = isColumn ? computed.justifyContent : computed.alignItems;
        const map = { center: 'center', 'flex-end': 'flex-end', end: 'flex-end', 'self-end': 'flex-end' };
        target.style.setProperty('display', 'flex');
        target.style.setProperty('flex-direction', 'column');
        target.style.setProperty('justify-content', map[vertical] || 'flex-start');
        target.style.setProperty('align-items', 'stretch');
    }

    /* Blocks with text that sit side by side (flex row, grid, columns, floats): flattening stacks them. */
    function hasSideBySideText(parent) {
        const view = parent.ownerDocument.defaultView;
        const boxes = Array.from(parent.children).filter((child) => {
            const computed = view.getComputedStyle(child);
            return !isHidden(computed) && computed.display !== 'inline' && child.textContent.trim() !== '';
        }).map((child) => child.getBoundingClientRect());
        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i];
                const b = boxes[j];
                const sameRow = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
                const apart = a.right <= b.left + 1 || b.right <= a.left + 1;
                if (sameRow && apart) {
                    return true;
                }
            }
        }
        return Array.from(parent.children).some(hasSideBySideText);
    }

    // Formatting the normalizer understands, written where an element differs from its parent.
    function differences(look, parentLook, isBlockLevel) {
        const style = {};
        ['font-family', 'font-size', 'color'].forEach((property) => {
            if (look[property] !== parentLook[property]) {
                style[property] = look[property];
            }
        });
        if (look['font-weight'] === 'bold' && parentLook['font-weight'] !== 'bold') {
            style['font-weight'] = 'bold';
        }
        if (look['font-style'] === 'italic' && parentLook['font-style'] !== 'italic') {
            style['font-style'] = 'italic';
        }
        if (isBlockLevel) {
            ['text-align', 'line-height'].forEach((property) => {
                if (look[property] !== parentLook[property]) {
                    style[property] = look[property];
                }
            });
        }
        return style;
    }

    // Attributes that carry meaning for the model or for links.
    const KEPT_ATTRIBUTES = ['href', 'start', 'value', 'data-list', 'data-level', 'data-start'];

    /*
     * A copy of `element` (from the rendered deck) in `doc`, whose inline styles
     * say only what differs from `parentLook`. normalize() then flattens it.
     */
    function styledCopy(element, doc, parentLook, options, isRoot) {
        const view = element.ownerDocument.defaultView;
        const computed = view.getComputedStyle(element);
        const tag = tagOf(element);
        const copy = doc.createElement(tag);
        KEPT_ATTRIBUTES.forEach((name) => {
            if (element.hasAttribute(name)) {
                copy.setAttribute(name, element.getAttribute(name));
            }
        });

        const look = lookOf(computed, options.scale, element);
        const isBlockLevel = computed.display !== 'inline';
        const style = differences(look, parentLook, isBlockLevel);
        if (!hasOwnText(element)) {
            // A container (<ul>, a wrapper <div>): its children say their own look, which
            // avoids a size on the list that every item overrides anyway.
            delete style['font-family'];
            delete style['font-size'];
            delete style.color;
        }
        const decoration = computed.textDecorationLine;
        if (decoration && decoration !== 'none') {
            style['text-decoration-line'] = decoration;
        }
        if (!isBlockLevel && !/rgba\(.*,\s*0\)$|transparent/.test(computed.backgroundColor)) {
            style['background-color'] = themeColor(computed.backgroundColor, themeValues(element.ownerDocument));
        }
        if (/^(ul|ol)$/.test(tag) && computed.listStyleType === 'none' && !hasMarkerContent(element)) {
            style['list-style-type'] = 'none';
        }
        // List items take their spacing from the box's list settings (writeListSettings), not inline.
        const marginsCount = isBlockLevel && !isRoot && tag !== 'li';
        ['margin-top', 'margin-bottom'].forEach((property) => {
            const px = parseFloat(computed.getPropertyValue(property)) * options.scale;
            if (marginsCount && px > 0) {
                style[property] = round2(px) + 'px';
            }
        });
        Object.keys(style).forEach((property) => copy.style.setProperty(property, style[property]));

        // What the copy's children inherit in the output: the parent's look plus what we wrote.
        const inherited = Object.assign({}, parentLook);
        Object.keys(style).forEach((property) => {
            if (property in look) {
                inherited[property] = look[property];
            }
        });
        appendStyledChildren(element, copy, doc, inherited, options);
        return copy;
    }

    function hasOwnText(element) {
        return Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '');
    }

        function hasMarkerContent(list) {
        const view = list.ownerDocument.defaultView;
        return Array.from(list.children).some((item) => {
            const content = view.getComputedStyle(item, '::before').content;
            return content && content !== 'none' && content !== 'normal';
        });
    }

    function appendStyledChildren(element, copy, doc, parentLook, options) {
        const view = element.ownerDocument.defaultView;
        element.childNodes.forEach((child) => {
            if (child.nodeType === Node.TEXT_NODE) {
                copy.appendChild(doc.createTextNode(transformedText(child, parentLook)));
            } else if (child.nodeType === Node.ELEMENT_NODE && !DROP_TAGS.has(tagOf(child)) &&
                       !isHidden(view.getComputedStyle(child))) {
                copy.appendChild(tagOf(child) === 'br' ? doc.createElement('br') : styledCopy(child, doc, parentLook, options, false));
            }
        });
    }

    /* Upper/lower case applied to only part of the box is written into the text itself. */
    function transformedText(node, parentLook) {
        const transform = node.parentElement
            ? node.parentElement.ownerDocument.defaultView.getComputedStyle(node.parentElement).textTransform : 'none';
        if (transform === parentLook['box-transform']) {
            return node.textContent;
        }
        if (transform === 'uppercase') {
            return node.textContent.toUpperCase();
        }
        if (transform === 'lowercase') {
            return node.textContent.toLowerCase();
        }
        return node.textContent;
    }

    function px(computed, property) {
        return parseFloat(computed.getPropertyValue(property)) || 0;
    }

    /*
     * The deck's own list indent and spacing, kept on this text box as
     * --list-N-indent / --list-N-space-before when they differ from the theme:
     * the text stays where it was (and still fits its box), while every other
     * box follows the theme. Per level, the value most items have wins.
     */
    function writeListSettings(source, target, settings) {
        const view = source.ownerDocument.defaultView;
        const sourceStyle = view.getComputedStyle(source);
        const rect = source.getBoundingClientRect();
        const isList = /^(ul|ol)$/.test(tagOf(source));
        // Where text starts in the box (a list root's own padding is its indent, not box padding).
        const contentLeft = rect.left + px(sourceStyle, 'border-left-width') +
            (settings.includeSource && isList ? 0 : px(sourceStyle, 'padding-left'));
        const votes = {};
        source.querySelectorAll('li').forEach((item) => {
            const computed = view.getComputedStyle(item);
            if (isHidden(computed)) {
                return;
            }
            let level = 0;
            for (let node = item.parentElement; node && (node === source || source.contains(node)); node = node.parentElement) {
                if (/^(ul|ol)$/.test(tagOf(node))) {
                    level += 1;
                }
                if (node === source) {
                    break;
                }
            }
            level = Math.min(Math.max(level, 1), MAX_LEVEL);
            const indent = round2((item.getBoundingClientRect().left + px(computed, 'padding-left') - contentLeft) * settings.scale) + 'px';
            // Space between items: an item's top or bottom margin, whichever is larger (they collapse).
            const space = round2(Math.max(px(computed, 'margin-top'), px(computed, 'margin-bottom')) * settings.scale) + 'px';
            votes[level] = votes[level] || { indent: new Map(), space: new Map() };
            votes[level].indent.set(indent, (votes[level].indent.get(indent) || 0) + 1);
            votes[level].space.set(space, (votes[level].space.get(space) || 0) + 1);
        });
        Object.keys(votes).forEach((level) => {
            const defaults = App.text.LIST_DEFAULTS[level - 1];
            const indent = mostVoted(votes[level].indent);
            const space = mostVoted(votes[level].space);
            if (parseFloat(indent) !== parseFloat(defaults.indent)) {
                target.style.setProperty('--list-' + level + '-indent', indent);
            }
            if (parseFloat(space) !== parseFloat(defaults.spaceBefore) * 4 / 3) {
                target.style.setProperty('--list-' + level + '-space-before', space);
            }
        });
    }

    function mostVoted(tally) {
        let best = null;
        tally.forEach((count, value) => {
            if (best === null || count > tally.get(best)) {
                best = value;
            }
        });
        return best;
    }

    /*
     * Convert the text of a rendered element into the text model, keeping its look
     * (SPEC 3.4). `source` lives in a laid-out document (the importer's measuring
     * iframe), so computed styles are real. `target` is the text element in the
     * deck being built: it receives the box-wide look and the flat paragraphs.
     *   options.scale          slide scale (e.g. 2/3 for a 1920x1080 deck)
     *   options.includeSource  true: `source` is a block (heading, list …) that becomes
     *                          the text; false: `source` is a text element, its children are the text
     * Returns { layoutFlattened }: true when blocks of text sat side by side and
     * are now stacked lines (the import report asks the user to check the box).
     */
    App.text.fromRendered = function fromRendered(source, target, options) {
        const settings = Object.assign({ scale: 1, includeSource: false }, options || {});
        const view = source.ownerDocument.defaultView;
        const doc = target.ownerDocument;
        const sourceStyle = view.getComputedStyle(source);
        const textNodes = visibleTextNodes(source);

        const box = textNodes.length > 0 ? boxLook(textNodes, settings.scale) : lookOf(sourceStyle, settings.scale, source);
        writeBoxLook(target, box);
        keepVerticalAlignment(sourceStyle, target);
        const layoutFlattened = hasSideBySideText(source);

        const parentLook = Object.assign({}, box, { 'box-transform': box['text-transform'] });
        const holder = doc.createElement('div');
        if (settings.includeSource) {
            holder.appendChild(styledCopy(source, doc, parentLook, settings, true));
        } else {
            appendStyledChildren(source, holder, doc, parentLook, settings);
        }
        target.replaceChildren(...Array.from(holder.childNodes));
        App.text.normalize(target);
        writeListSettings(source, target, settings);
        return { layoutFlattened: layoutFlattened };
    };

    // ---------------------------------------------------------------
    // The cursor as data: { anchor: { p, o }, focus: { p, o } }
    // ---------------------------------------------------------------
    //
    // p = which line (child of the text element), o = how many characters into
    // it, a <br> counting as one. Unlike DOM nodes, this survives the slide being
    // rebuilt from a snapshot (undo), so undo can put the cursor back.

    function lineOf(element, node) {
        let current = node;
        while (current && current.parentNode !== element) {
            current = current.parentNode;
        }
        return current;
    }

    function positionOf(element, container, offset) {
        const lines = Array.from(element.children);
        if (container === element) {
            if (offset >= lines.length) {
                const last = lines.length - 1;
                return { p: Math.max(last, 0), o: last >= 0 ? lineLength(lines[last]) : 0 };
            }
            return { p: offset, o: 0 };
        }
        const line = lineOf(element, container);
        const index = lines.indexOf(line);
        if (index === -1) {
            return { p: 0, o: 0 };
        }
        const range = element.ownerDocument.createRange();
        range.setStart(line, 0);
        range.setEnd(container, offset);
        let o = 0;
        for (const item of inlineItems(line)) {
            if (item === container) {
                o += offset;   // the cursor is inside this text
                break;
            }
            const isText = item.nodeType === Node.TEXT_NODE;
            // Is the end of this item at or before the cursor?
            const end = isText ? [item, item.length] : [item.parentNode, Array.prototype.indexOf.call(item.parentNode.childNodes, item) + 1];
            if (range.comparePoint(end[0], end[1]) > 0) {
                break;
            }
            o += isText ? item.length : 1;
        }
        return { p: index, o: o };
    }

    function lineLength(line) {
        return inlineItems(line).reduce((sum, item) => sum + (item.nodeType === Node.TEXT_NODE ? item.length : 1), 0);
    }

    /* The DOM point { node, offset } for a position; out of range means the end of the text. */
    function pointOf(element, position) {
        const lines = Array.from(element.children);
        if (lines.length === 0) {
            return { node: element, offset: 0 };
        }
        const line = lines[Math.min(position.p, lines.length - 1)];
        let remaining = position.p >= lines.length ? Infinity : position.o;
        const items = inlineItems(line);
        for (const item of items) {
            if (item.nodeType === Node.TEXT_NODE) {
                if (remaining <= item.length) {
                    return { node: item, offset: remaining };
                }
                remaining -= item.length;
            } else {
                if (remaining === 0) {
                    return { node: item.parentNode, offset: Array.prototype.indexOf.call(item.parentNode.childNodes, item) };
                }
                remaining -= 1;
            }
        }
        // The end of the line: after its last text (a final <br> only keeps the line open).
        const lastText = items.filter((item) => item.nodeType === Node.TEXT_NODE).pop();
        return lastText ? { node: lastText, offset: lastText.length } : { node: line, offset: 0 };
    }

    /* The selection inside `element` as positions, or null when the selection is elsewhere. */
    App.text.getCaret = function getCaret(element) {
        const selection = element.ownerDocument.getSelection();
        if (!selection || selection.rangeCount === 0 || !element.contains(selection.anchorNode) ||
            !element.contains(selection.focusNode)) {
            return null;
        }
        return {
            anchor: positionOf(element, selection.anchorNode, selection.anchorOffset),
            focus: positionOf(element, selection.focusNode, selection.focusOffset),
        };
    };

    App.text.setCaret = function setCaret(element, caret) {
        const anchor = pointOf(element, caret.anchor);
        const focus = pointOf(element, caret.focus);
        element.ownerDocument.getSelection().setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
    };

    const END_OF_TEXT = { anchor: { p: Infinity, o: 0 }, focus: { p: Infinity, o: 0 } };

    // ---------------------------------------------------------------
    // New text boxes and boxes that grow with their text
    // ---------------------------------------------------------------

    /*
     * A new, empty text box at rect { left, top, width } (slide px). It takes the
     * deck's body font and colour, and grows with its text (data-autofit="resize",
     * like PowerPoint's inserted text boxes).
     */
    App.text.createTextElement = function createTextElement(doc, rect, id) {
        const element = doc.createElement('div');
        element.setAttribute('class', 'el');
        element.setAttribute('data-type', 'text');
        if (id) {
            element.setAttribute('data-id', id);
        }
        element.setAttribute('data-autofit', 'resize');
        element.setAttribute('style', 'left: ' + rect.left + 'px; top: ' + rect.top + 'px; width: ' + rect.width +
            'px; height: 40px; font-size: 18pt; line-height: 1.2;');
        element.innerHTML = '<p data-list="none" data-level="1"><br></p>';
        return element;
    };

    /* A data-autofit="resize" box takes exactly the height of its text. Returns true if it changed. */
    App.text.fitHeight = function fitHeight(element) {
        if (element.getAttribute('data-autofit') !== 'resize') {
            return false;
        }
        const old = element.style.height;
        element.style.height = 'auto';
        const height = element.offsetHeight + 'px';
        element.style.height = height;
        return height !== old;
    };

    // ---------------------------------------------------------------
    // Edit mode
    // ---------------------------------------------------------------
    //
    // The text element itself becomes contenteditable inside the deck iframe;
    // the overlay lets the mouse through to it (CSS: #overlay.editing). The
    // browser only types characters; everything structural goes through here.
    // Typing is recorded as history steps: one step per run of typing, split
    // by a 1-second pause or a new paragraph; each step keeps the cursor
    // before and after it (history meta), so undo/redo put the cursor back.

    const TYPING_PAUSE_MS = 1000;
    let editing = null;   // { element, id, slideId, isNew, doc }
    let typing = null;    // { meta, timer } while a typing step is open

    App.text.isEditing = function isEditing() {
        return editing !== null;
    };

    App.text.editingElement = function editingElement() {
        return editing ? editing.element : null;
    };

    function markEditable(element) {
        element.setAttribute('contenteditable', 'true');
        element.setAttribute('spellcheck', 'true');
        element.classList.add('editor-editing');
    }

    function unmarkEditable(element) {
        element.removeAttribute('contenteditable');
        element.removeAttribute('spellcheck');
        element.classList.remove('editor-editing');
    }

    function overlayElement() {
        return document.getElementById('overlay');
    }

    /*
     * Start editing `element`. options.point { x, y } (slide px) puts the cursor
     * where the user double-clicked; options.caret 'start' or (default) the end.
     * options.isNew: a box just inserted, removed again if left empty.
     */
    App.text.enterEdit = function enterEdit(element, options) {
        const settings = options || {};
        if (editing && editing.element === element) {
            return;
        }
        if (editing) {
            App.text.exitEdit({ select: false });
        }
        const doc = element.ownerDocument;
        editing = {
            element: element, id: element.getAttribute('data-id'), doc: doc, isNew: !!settings.isNew,
            slideId: element.closest('section.slide').getAttribute('data-slide-id'),
        };
        if (!doc.documentElement.getAttribute('lang')) {
            doc.documentElement.setAttribute('lang', 'pt-BR');   // spell check in Portuguese (SPEC Phase 3)
        }
        doc.execCommand('defaultParagraphSeparator', false, 'p');
        attachToElement(element);
        doc.addEventListener('keydown', onKeyDown, true);
        doc.addEventListener('pointerdown', onDeckPointerDown, true);
        window.addEventListener('pointerdown', onEditorPointerDown, true);
        overlayElement().classList.add('editing');

        element.focus({ preventScroll: true });
        placeInitialCaret(element, settings);
        App.events.emit('text-edit-changed', { editing: true, id: editing.id });
    };

    function attachToElement(element) {
        markEditable(element);
        element.addEventListener('beforeinput', onBeforeInput);
        element.addEventListener('input', onInput);
    }

    function detachFromElement(element) {
        element.removeEventListener('beforeinput', onBeforeInput);
        element.removeEventListener('input', onInput);
        unmarkEditable(element);
    }

    function placeInitialCaret(element, settings) {
        const doc = element.ownerDocument;
        if (settings.point && doc.caretRangeFromPoint) {
            const range = doc.caretRangeFromPoint(settings.point.x, settings.point.y);
            if (range && element.contains(range.startContainer)) {
                doc.getSelection().removeAllRanges();
                doc.getSelection().addRange(range);
                return;
            }
        }
        App.text.setCaret(element, settings.caret === 'start'
            ? { anchor: { p: 0, o: 0 }, focus: { p: 0, o: 0 } } : END_OF_TEXT);
    }

    /*
     * Leave edit mode: the typing step is closed, the text normalized, and a new
     * box left empty is removed. options.select (default true) keeps the box selected.
     */
    App.text.exitEdit = function exitEdit(options) {
        if (!editing) {
            return;
        }
        App.text.commitTyping();
        const state = editing;
        editing = null;
        state.doc.removeEventListener('keydown', onKeyDown, true);
        state.doc.removeEventListener('pointerdown', onDeckPointerDown, true);
        window.removeEventListener('pointerdown', onEditorPointerDown, true);
        overlayElement().classList.remove('editing');
        const element = state.element;
        if (element.isConnected) {
            detachFromElement(element);
            App.text.normalize(element);
            App.text.fitHeight(element);
            element.blur();
            state.doc.getSelection().removeAllRanges();
            if (state.isNew && element.textContent.trim() === '') {
                App.history.change('Delete empty text box', { slideId: state.slideId }, () => element.remove());
            } else if (!options || options.select !== false) {
                App.selection.select(element);
            }
        }
        window.focus();
        App.events.emit('text-edit-changed', { editing: false, id: state.id });
    };

    /* Close the open typing step now (before saving, a command, leaving edit mode). */
    App.text.commitTyping = function commitTyping() {
        if (typing && App.history.isPending()) {
            App.history.commit();   // runs the step's onCommit, which clears `typing`
        }
        typing = null;
    };

    function startTyping() {
        const element = editing.element;
        const meta = { textId: editing.id, caretBefore: App.text.getCaret(element), caretAfter: null };
        typing = { meta: meta, timer: null };
        App.history.begin('Typing', { slideId: editing.slideId }, {
            meta: meta,
            onCommit: () => {
                if (editing && editing.element.isConnected) {
                    meta.caretAfter = App.text.getCaret(editing.element);
                }
                if (typing) {
                    clearTimeout(typing.timer);
                }
                typing = null;
            },
        });
    }

    function onBeforeInput(event) {
        if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
            // The browser's own text undo is replaced by the editor's (one undo stack).
            event.preventDefault();
            App.commands.run(event.inputType === 'historyUndo' ? 'undo' : 'redo');
            return;
        }
        if (event.inputType === 'insertParagraph') {
            App.text.commitTyping();   // a new paragraph starts a new undo step
        }
        if (!typing) {
            startTyping();
        }
        clearTimeout(typing.timer);
        typing.timer = setTimeout(App.text.commitTyping, TYPING_PAUSE_MS);
    }

    function onInput() {
        const element = editing && editing.element;
        if (!element) {
            return;
        }
        ensureLines(element);
        if (App.text.fitHeight(element)) {
            App.selection.refresh();
        }
    }

    /*
     * The browser can leave text outside any <p> (e.g. after deleting everything).
     * Only then is the text normalized during typing, keeping the cursor.
     */
    function ensureLines(element) {
        const broken = element.children.length === 0 || Array.from(element.childNodes).some((node) =>
            (node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '') ||
            (node.nodeType === Node.ELEMENT_NODE && tagOf(node) !== 'p'));
        if (!broken) {
            return;
        }
        const caret = App.text.getCaret(element);
        App.text.normalize(element);
        if (element.children.length === 0) {
            element.innerHTML = '<p data-list="none" data-level="1"><br></p>';
        }
        App.text.setCaret(element, caret || END_OF_TEXT);
    }

    function onKeyDown(event) {
        if (event.isComposing) {
            return;
        }
        const ctrl = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();
        let command = null;
        if (event.key === 'Escape') {
            command = 'exit';
        } else if (ctrl && !event.altKey && key === 'z') {
            command = event.shiftKey ? 'redo' : 'undo';
        } else if (ctrl && !event.altKey && !event.shiftKey && key === 'y') {
            command = 'redo';
        }
        if (!command) {
            return;
        }
        // Ours, not the browser's: its text undo would bypass the editor's history.
        event.preventDefault();
        event.stopPropagation();
        if (command === 'exit') {
            App.text.exitEdit();
        } else {
            App.commands.run(command);
        }
    }

    /* A press on the slide outside the text: leave edit mode and select what is there. */
    function onDeckPointerDown(event) {
        if (!editing || editing.element.contains(event.target)) {
            return;
        }
        event.preventDefault();
        App.text.exitEdit({ select: false });
        // The deck iframe shows the slide at 1:1, so its coordinates are slide pixels.
        App.selection.select(App.selection.elementAt(event.clientX, event.clientY));
    }

    /* A press anywhere in the editor outside the deck (rail, ribbon …) leaves edit mode,
       except on controls that work on the text being edited (marked data-keep-edit). */
    function onEditorPointerDown(event) {
        if (editing && !(event.target.closest && event.target.closest('[data-keep-edit]'))) {
            App.text.exitEdit();
        }
    }

    /* After undo/redo the slide was rebuilt: find the box again and put the cursor back. */
    function afterHistoryChange(info) {
        const doc = App.deck.getDocument();
        if (!editing) {
            // A snapshot taken while editing may bring editing marks back; they do not belong there.
            if (doc && (info.action === 'undo' || info.action === 'redo')) {
                doc.querySelectorAll('[contenteditable]').forEach(unmarkEditable);
            }
            return;
        }
        if (editing.element.isConnected) {
            return;
        }
        const found = doc && doc.querySelector('[data-slide-id="' + CSS.escape(editing.slideId) + '"] [data-id="' +
            CSS.escape(editing.id) + '"]');
        if (!found) {
            App.text.exitEdit({ select: false });
            return;
        }
        editing.element = found;
        attachToElement(found);
        found.focus({ preventScroll: true });
        const meta = info.meta && info.meta.textId === editing.id ? info.meta : null;
        const caret = meta && (info.action === 'undo' ? meta.caretBefore : meta.caretAfter);
        App.text.setCaret(found, caret || END_OF_TEXT);
        App.selection.select(found);
    }

    /* Wiring, called once from App.start(). */
    App.text.init = function init() {
        App.events.on('history-changed', afterHistoryChange);
        // deck.js also re-marks the same slide after undo; only a real slide change ends editing.
        App.events.on('slide-changed', () => {
            const slide = App.deck.getCurrentSlide();
            if (editing && (!slide || slide.getAttribute('data-slide-id') !== editing.slideId)) {
                App.text.exitEdit({ select: false });
            }
        });
        App.events.on('deck-loaded', () => {
            editing = null;
            typing = null;
            overlayElement().classList.remove('editing');
        });
    };
})();
