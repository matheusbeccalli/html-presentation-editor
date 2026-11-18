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
 * (getCaret / setCaret as line + character). Bullet keys (Tab, Enter,
 * Backspace … and "- " AutoFormat) are decided by keyAction and run as one
 * undo step each; setLevel changes levels. Still to come in Phase 3:
 * applyStyle, toggleList.
 *
 * Table cells (Phase 4) hold the same model: normalizeCell; tables.js owns the
 * rows and columns around them, never the text inside.
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
            // A table cell is a text of its own (Phase 4): its numbering starts at 1.
            '.el td { counter-reset: list-1 list-2 list-3 list-4 list-5; }',
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
        // Autofit "shrink": the lines are drawn at the scale the editor measured (fitText). zoom,
        // unlike a transform, lets the smaller text wrap again over the full width of the box.
        rules.push('.el[data-autofit="shrink"] > p { zoom: var(--autofit-scale, 1); }');
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
     * A table cell holds text in the same model as a text box (Phase 4), plus
     * one rule: it always keeps a line, so there is somewhere to type.
     */
    App.text.normalizeCell = function normalizeCell(cell) {
        App.text.normalize(cell);
        if (!cell.firstElementChild) {
            const p = cell.ownerDocument.createElement('p');
            p.setAttribute('data-list', 'none');
            p.setAttribute('data-level', '1');
            p.appendChild(cell.ownerDocument.createElement('br'));
            cell.appendChild(p);
        }
    };

    /* The text of each line of a container (a line break as "\n"). */
    App.text.lineTexts = function lineTexts(container) {
        return Array.from(container.children).map(lineText);
    };

    /*
     * Replace the text of a container by `lines` of plain text, all bold and / or
     * italic when look.bold / look.italic (cells pasted from Excel), as a list
     * when look.list is 'bullet' or 'number' (the body of a new slide).
     */
    App.text.writeLines = function writeLines(container, lines, look) {
        const doc = container.ownerDocument;
        container.replaceChildren(...lines.map((line) => {
            const p = doc.createElement('p');
            let holder = p;
            ['bold', 'italic'].filter((name) => look && look[name]).forEach((name) => {
                holder = holder.appendChild(doc.createElement(name === 'bold' ? 'b' : 'i'));
            });
            holder.textContent = line;
            return p;
        }));
        App.text.normalizeCell(container);
        if (look && look.list) {
            Array.from(container.children).forEach((p) => p.setAttribute('data-list', look.list));
        }
    };

    /* Remove all the text of a container (selected table cells + Delete), leaving one empty line. */
    App.text.clearText = function clearText(container) {
        container.replaceChildren();
        App.text.normalizeCell(container);
    };

    // ---------------------------------------------------------------
    // Where text lives: text boxes, table cells and shapes' text ("containers")
    // ---------------------------------------------------------------

    function isCell(container) {
        return tagOf(container) === 'td';
    }

    function isShapeText(container) {
        return !!container.classList && container.classList.contains('shape-text');
    }

    /* A container inside its slide element (a cell, a shape's text), not a text box itself. */
    function isInner(container) {
        return isCell(container) || isShapeText(container);
    }

    /* The slide element around a container: the text box itself, the table of a cell, the shape of its text. */
    function boxOf(container) {
        // A part of a group: the group is what the slide selects (groups.js).
        return App.groups.topOf(isInner(container) ? container.closest('.el') : container);
    }

    /* Every text box, table cell and shape text inside `root`, in reading order (find & replace walks them). */
    App.text.containersIn = function containersIn(root) {
        return Array.from(root.querySelectorAll('.el[data-type="text"], ' + App.tables.CELL_SELECTOR + ', ' +
            App.shapes.TEXT_SELECTOR));
    };

    /* The text a selected slide element holds: a text box itself, a shape's text area; else null. */
    App.text.textOf = function textOf(element) {
        const type = element && element.getAttribute('data-type');
        return type === 'text' ? element : type === 'shape' ? App.shapes.textOf(element) : null;
    };

    /*
     * A name for a container that survives the slide being rebuilt (undo):
     * a text box's data-id, "tableId/row/cell" for a table cell, "shapeId/text" for a shape's text.
     */
    App.text.containerKey = function containerKey(container) {
        if (isShapeText(container)) {
            return boxOf(container).getAttribute('data-id') + '/text';
        }
        if (!isCell(container)) {
            return container.getAttribute('data-id');
        }
        const row = container.parentElement;
        return boxOf(container).getAttribute('data-id') + '/' + row.rowIndex + '/' + container.cellIndex;
    };

    /* The container named `key` on slide `slideId` of `doc`, or null. */
    App.text.findContainer = function findContainer(doc, slideId, key) {
        const [id, row, cell] = key.split('/');
        const element = doc.querySelector('[data-slide-id="' + CSS.escape(slideId) + '"] [data-id="' + CSS.escape(id) + '"]');
        if (!element || row === undefined) {
            return element;
        }
        if (row === 'text') {
            return element.querySelector(':scope > .shape-text');
        }
        const table = element.querySelector(':scope > table');
        const tableRow = table && table.rows[Number(row)];
        return (tableRow && tableRow.cells[Number(cell)]) || null;
    };

    /*
     * After the text changed: a text box fits its text (autofit), a table its
     * rows (a row grows with its text). Returns true when the box changed size.
     */
    App.text.fitBox = function fitBox(container) {
        if (isShapeText(container)) {
            return false;   // a shape keeps its size; its text may run past it, as in PowerPoint
        }
        return isCell(container) ? App.tables.fitTable(boxOf(container)) : App.text.fitText(container);
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

    /*
     * The text of a container as it shows, for the PowerPoint export (Phase 8, pptx.js),
     * so no other module reads the text model itself:
     *   [{ list: 'bullet' | 'number' | 'none', level: 1-5, number (the number shown, or null),
     *      marker (the bullet character shown, or ''), align, lineHeight (px, or null for normal),
     *      fontSize (px), spaceBefore / spaceAfter (px), indent (px from the box's left to the text),
     *      runs: [{ text, breakBefore, look }] }]
     * look = { fontFamily, fontSize (px), color, bold, italic, underline, strike, superscript,
     *          subscript, highlight (a colour or null), letterSpacing (px) } from the browser's
     * computed styles, so the container must be in the page and shown (deck.withSlideShown).
     * Spaces are collapsed as the browser shows them; a <br> starts the next run on a new line.
     */
    App.text.exportParagraphs = function exportParagraphs(container) {
        const view = container.ownerDocument.defaultView;
        const numbers = shownNumbers(textLines(container));
        return textLines(container).map((p, index) => {
            const style = view.getComputedStyle(p);
            const marker = view.getComputedStyle(p, '::before').content;
            const list = listOf(p);
            const runs = [];
            let breakNext = false;
            inlineItems(p).forEach((item) => {
                if (item.nodeType !== Node.TEXT_NODE) {
                    breakNext = true;
                    return;
                }
                // As the browser shows it: runs of ordinary spaces and line breaks are one space
                // (a non-breaking space stays: it was typed on purpose).
                const text = item.textContent.replace(/[ \t\n\r\f]+/g, ' ');
                if (!text) {
                    return;
                }
                runs.push({ text: text, breakBefore: breakNext, look: exportLook(item.parentElement, container, view) });
                breakNext = false;
            });
            if (runs.length > 0) {
                const first = runs[0];
                first.text = first.breakBefore ? first.text : first.text.replace(/^ /, '');
                const last = runs[runs.length - 1];
                last.text = last.text.replace(/ $/, '');
            }
            const lineHeight = parseFloat(style.lineHeight);
            return {
                list: list,
                level: levelOf(p),
                number: numbers[index],
                marker: list === 'bullet' && /^["'].*["']$/.test(marker) ? marker.slice(1, -1) : '',
                align: style.textAlign === 'start' ? 'left' : style.textAlign === 'end' ? 'right' : style.textAlign,
                lineHeight: isFinite(lineHeight) ? lineHeight : null,
                fontSize: parseFloat(style.fontSize),
                spaceBefore: parseFloat(style.marginTop) || 0,
                spaceAfter: parseFloat(style.marginBottom) || 0,
                indent: parseFloat(style.paddingLeft) || 0,
                runs: runs,
                emptyLook: runs.length === 0 ? exportLook(p, container, view) : null,
            };
        });
    };

    // The look of the text inside `element` (up to the container: underline and strike are drawn
    // by an ancestor, vertical-align too, so they are looked for on the way up).
    function exportLook(element, container, view) {
        const style = view.getComputedStyle(element);
        let underline = false;
        let strike = false;
        let shift = 'baseline';
        let highlight = null;
        for (let node = element; node; node = node.parentElement) {
            const own = view.getComputedStyle(node);
            underline = underline || own.textDecorationLine.indexOf('underline') !== -1;
            strike = strike || own.textDecorationLine.indexOf('line-through') !== -1;
            if (shift === 'baseline' && (own.verticalAlign === 'super' || own.verticalAlign === 'sub')) {
                shift = own.verticalAlign;
            }
            const background = own.backgroundColor;
            if (!highlight && node !== container && background && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(background)) {
                highlight = background;
            }
            if (node === container) {
                break;
            }
        }
        return {
            fontFamily: style.fontFamily,
            fontSize: parseFloat(style.fontSize),
            color: style.color,
            bold: (parseInt(style.fontWeight, 10) || 400) >= 600,
            italic: style.fontStyle === 'italic' || style.fontStyle === 'oblique',
            underline: underline,
            strike: strike,
            superscript: shift === 'super',
            subscript: shift === 'sub',
            highlight: highlight,
            letterSpacing: parseFloat(style.letterSpacing) || 0,
            uppercase: style.textTransform === 'uppercase',
        };
    }

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

    /* The custom properties a document's :root rules define whose names match `pattern`, in order. */
    function rootVariables(doc, pattern) {
        const names = [];
        Array.from(doc.styleSheets).forEach((sheet) => {
            let rules = [];
            try {
                rules = Array.from(sheet.cssRules || []);
            } catch (error) {
                return;   // a blocked remote stylesheet: the browser will not show its rules
            }
            rules.forEach((rule) => {
                if (rule.selectorText && /(^|,)\s*:root\s*($|,)/.test(rule.selectorText)) {
                    Array.from(rule.style).forEach((name) => {
                        if (pattern.test(name) && names.indexOf(name) === -1) {
                            names.push(name);
                        }
                    });
                }
            });
        });
        return names;
    }

    /* Forget what themeValues remembered of `doc` (theme.js: after a theme change or its undo). */
    App.text.forgetTheme = function forgetTheme(doc) {
        themeCache.delete(doc);
    };

    /* The deck's theme colours, e.g. ['--color-primary', '--color-accent', …] (the colour pickers' first row). */
    App.text.themeColorNames = function themeColorNames(doc) {
        return rootVariables(doc, /^--color-[a-z0-9-]+$/);
    };

    function themeValues(sourceDoc) {
        if (themeCache.has(sourceDoc)) {
            return themeCache.get(sourceDoc);
        }
        const names = rootVariables(sourceDoc, /^--(font-(heading|body)|color-[a-z0-9-]+)$/)
            .filter((name) => !/^--color-(bg|background)/.test(name));
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

    /* A computed colour of `sourceDoc` as var(--color-…) when it is a theme colour (tables.js: cell fills). */
    App.text.themeColorOf = function themeColorOf(value, sourceDoc) {
        return themeColor(value, themeValues(sourceDoc));
    };

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

    // ---------------------------------------------------------------
    // Autofit: data-autofit="shrink|resize|off"
    // ---------------------------------------------------------------

    const MIN_SHRINK = 0.25;   // text never gets smaller than a quarter of its size
    const AUTOFIT_LABELS = { off: 'Do not autofit', shrink: 'Shrink text on overflow', resize: 'Resize shape to fit text' };

    function fits(element) {
        return element.scrollHeight <= element.clientHeight + 1;
    }

    /* A "shrink" box: the largest scale (two decimals) at which its text fits; none when it fits as it is. */
    function shrinkToFit(element) {
        const old = element.style.getPropertyValue('--autofit-scale');
        element.style.removeProperty('--autofit-scale');
        if (!fits(element)) {
            let low = MIN_SHRINK;
            let high = 1;
            for (let i = 0; i < 10; i++) {   // halving the gap: 10 steps are finer than 0.01
                const middle = (low + high) / 2;
                element.style.setProperty('--autofit-scale', String(middle));
                if (fits(element)) {
                    low = middle;
                } else {
                    high = middle;
                }
            }
            element.style.setProperty('--autofit-scale', String(Math.floor(low * 100) / 100));
        }
        return element.style.getPropertyValue('--autofit-scale') !== old;
    }

    /*
     * Fit a text box to its text after a change (typing, a command, a resize):
     * "resize" sets the box's height, "shrink" the text's scale; "off" (or no
     * attribute, as for imported boxes) leaves both. Returns true if it changed.
     */
    App.text.fitText = function fitText(element) {
        if (!element || element.getAttribute('data-type') !== 'text') {
            return false;
        }
        const mode = element.getAttribute('data-autofit');
        if (mode === 'resize') {
            return App.text.fitHeight(element);
        }
        return mode === 'shrink' ? shrinkToFit(element) : false;
    };

    /* The autofit mode of a box ('off' when it has none). */
    App.text.autofitOf = function autofitOf(element) {
        const mode = element.getAttribute('data-autofit');
        return AUTOFIT_LABELS[mode] ? mode : 'off';
    };

    /* The action switching a box to autofit `mode` (fitting it at once), or null if it has that mode already. */
    App.text.autofitAction = function autofitAction(element, mode) {
        if (!AUTOFIT_LABELS[mode] || App.text.autofitOf(element) === mode && element.hasAttribute('data-autofit')) {
            return null;
        }
        return {
            label: AUTOFIT_LABELS[mode],
            run: () => {
                element.setAttribute('data-autofit', mode);
                if (mode !== 'shrink') {
                    element.style.removeProperty('--autofit-scale');
                }
                App.text.fitText(element);
            },
        };
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
    // Bullet behavior (SPEC Phase 3, "Bullet behavior")
    // ---------------------------------------------------------------
    //
    // keyAction decides what a key does to the lines; it changes nothing itself.
    // It returns null (the browser handles the key: typing, Shift+Enter, Backspace
    // inside text), { label: null } (the key is swallowed: Tab in the middle of
    // text), or { label, run } where run() changes the lines and returns the new
    // cursor. runAction runs it and tidies up; in the editor every run is one
    // undo step (text.js runInEditor). Tested by the key-sequence table in
    // tests/unit/text.test.js.

    function textLines(element) {
        return Array.from(element.children).filter((child) => tagOf(child) === 'p');
    }

    function listOf(line) {
        const list = line.getAttribute('data-list');
        return LIST_TYPES.indexOf(list) !== -1 ? list : 'none';
    }

    function levelOf(line) {
        return clampLevel(line.getAttribute('data-level'));
    }

    function isEmptyLine(line) {
        return line.textContent.replace(/[ \t\n\r\f]/g, '') === '';
    }

    function sameCaret(caret) {
        return caret.anchor.p === caret.focus.p && caret.anchor.o === caret.focus.o;
    }

    /* Change the level of lines first..last by delta (kept between 1 and 5). */
    function shiftLevels(element, first, last, delta) {
        textLines(element).slice(first, last + 1).forEach((line) => {
            line.setAttribute('data-level', String(Math.min(MAX_LEVEL, Math.max(1, levelOf(line) + delta))));
        });
    }

    function setListType(line, list) {
        line.setAttribute('data-list', list);
        if (list !== 'number') {
            line.removeAttribute('data-start');
        }
    }

    /* The last element inside `node` where a placeholder <br> keeps the line's formatting. */
    function appendPlaceholder(line) {
        let target = line;
        while (target.lastChild && target.lastChild.nodeType === Node.ELEMENT_NODE && tagOf(target.lastChild) !== 'br') {
            target = target.lastChild;
        }
        target.appendChild(line.ownerDocument.createElement('br'));
    }

    /* Enter: split the line at the cursor; the new line has the same list type and level. */
    function splitLine(element) {
        const doc = element.ownerDocument;
        const selection = doc.getSelection();
        if (!selection.isCollapsed) {
            doc.execCommand('delete');   // Enter replaces the selection, as in PowerPoint
        }
        const range = selection.getRangeAt(0);
        const line = lineOf(element, range.startContainer) || textLines(element)[0];
        const tail = doc.createRange();
        tail.setStart(range.startContainer, range.startOffset);
        tail.setEnd(line, line.childNodes.length);
        const newLine = line.cloneNode(false);   // same type, level and paragraph formatting …
        newLine.removeAttribute('data-start');   // … but a restart number belongs to the first line only
        newLine.appendChild(tail.extractContents());
        line.after(newLine);
        [line, newLine].forEach((part) => {
            if (isEmptyLine(part) && !part.querySelector('br')) {
                appendPlaceholder(part);
            }
        });
        return { p: textLines(element).indexOf(newLine), o: 0 };
    }

    /* Backspace at the start of a plain line: join it to the end of the line above. */
    function mergeWithPrevious(element, index) {
        const lines = textLines(element);
        const line = lines[index];
        const previous = lines[index - 1];
        const items = inlineItems(previous);
        const last = items[items.length - 1];
        if (last && last.nodeType !== Node.TEXT_NODE) {
            last.remove();   // the <br> that only kept the line above open
        }
        const o = lineLength(previous);
        if (!isEmptyLine(line)) {
            while (line.firstChild) {
                previous.appendChild(line.firstChild);
            }
        }
        line.remove();
        if (previous.childNodes.length === 0 || (isEmptyLine(previous) && !previous.querySelector('br'))) {
            appendPlaceholder(previous);
        }
        return { p: index - 1, o: o };
    }

    function caretAt(position) {
        return { anchor: position, focus: position };
    }

    App.text.keyAction = function keyAction(element, key) {
        if (key.isComposing) {
            return null;   // an IME is building a character (e.g. accents): its keys are not ours
        }
        const caret = App.text.getCaret(element);
        const lines = textLines(element);
        if (!caret || lines.length === 0) {
            return null;
        }
        const first = Math.min(caret.anchor.p, caret.focus.p);
        const last = Math.max(caret.anchor.p, caret.focus.p);
        const collapsed = sameCaret(caret);
        const line = lines[caret.focus.p];
        const list = listOf(line);
        const level = levelOf(line);
        const atLineStart = collapsed && caret.focus.o === 0;
        const ctrl = key.ctrlKey || key.metaKey;
        const keepCaret = () => caret;

        if (key.key === 'Tab' && !ctrl && !key.altKey) {
            if (first !== last || atLineStart) {
                const delta = key.shiftKey ? -1 : 1;
                return { label: delta > 0 ? 'Increase indent' : 'Decrease indent',
                    run: () => { shiftLevels(element, first, last, delta); return keepCaret(); } };
            }
            return { label: null };   // in the middle of text Tab inserts nothing
        }
        if ((key.key === 'ArrowRight' || key.key === 'ArrowLeft') && key.altKey && key.shiftKey && !ctrl) {
            const delta = key.key === 'ArrowRight' ? 1 : -1;
            return { label: delta > 0 ? 'Increase indent' : 'Decrease indent',
                run: () => { shiftLevels(element, first, last, delta); return keepCaret(); } };
        }
        if (key.key === 'Enter' && !key.shiftKey && !ctrl && !key.altKey) {
            if (collapsed && list !== 'none' && isEmptyLine(line)) {
                if (level > 1) {
                    return { label: 'Decrease indent', run: () => { shiftLevels(element, first, first, -1); return keepCaret(); } };
                }
                return { label: list === 'number' ? 'Remove numbering' : 'Remove bullet',
                    run: () => { setListType(line, 'none'); return keepCaret(); } };
            }
            return { label: 'New paragraph', run: () => caretAt(splitLine(element)) };
        }
        if (key.key === 'Backspace' && !ctrl && !key.altKey && !key.shiftKey && atLineStart) {
            if (list !== 'none') {
                if (level > 1) {
                    return { label: 'Decrease indent', run: () => { shiftLevels(element, first, first, -1); return keepCaret(); } };
                }
                return { label: list === 'number' ? 'Remove numbering' : 'Remove bullet',
                    run: () => { setListType(line, 'none'); return keepCaret(); } };
            }
            if (caret.focus.p === 0) {
                return { label: null };   // nothing above to merge with
            }
            return { label: 'Merge lines', run: () => caretAt(mergeWithPrevious(element, caret.focus.p)) };
        }
        return null;
    };

    // "- " or "* " starts a bullet, "1. " numbering (any number: it becomes the start).
    const AUTOFORMAT_RE = /^(?:([-*])|(\d{1,3})\.)[  ]$/;

    /*
     * Called after the user typed a space: if the plain line so far is "- ", "* "
     * or "1. ", the action turns it into a list line and removes those characters.
     * Run as its own undo step, Ctrl+Z right after brings back the typed "- ".
     */
    App.text.autoFormatAction = function autoFormatAction(element) {
        const caret = App.text.getCaret(element);
        if (!caret || !sameCaret(caret)) {
            return null;
        }
        const line = textLines(element)[caret.focus.p];
        if (!line || listOf(line) !== 'none') {
            return null;
        }
        const before = line.textContent.slice(0, caret.focus.o);
        const match = AUTOFORMAT_RE.exec(before);
        if (!match || lineLength(line) < caret.focus.o) {
            return null;
        }
        const number = match[2] ? parseInt(match[2], 10) : null;
        return {
            label: number === null ? 'Bullets (AutoFormat)' : 'Numbering (AutoFormat)',
            run: () => {
                const start = pointOf(element, { p: caret.focus.p, o: 0 });
                const end = pointOf(element, caret.focus);
                const range = element.ownerDocument.createRange();
                range.setStart(start.node, start.offset);
                range.setEnd(end.node, end.offset);
                range.deleteContents();
                setListType(line, number === null ? 'bullet' : 'number');
                if (number !== null && number !== 1) {
                    line.setAttribute('data-start', String(number));
                }
                if (isEmptyLine(line) && !line.querySelector('br')) {
                    appendPlaceholder(line);
                }
                return caretAt({ p: caret.focus.p, o: 0 });
            },
        };
    };

    // ---------------------------------------------------------------
    // Toolbar list buttons
    // ---------------------------------------------------------------
    //
    // Bullets, Numbering, Increase/Decrease indent, Restart/Continue numbering
    // (SPEC Phase 3, "Bullet behavior", Toolbar rows). Like the keys, each
    // button is an action { label, run }; it works on the selected lines, or on
    // every line when caret is null (the box is selected, not being edited).

    function selectedRange(element, caret) {
        if (!caret) {
            return { first: 0, last: textLines(element).length - 1 };
        }
        return { first: Math.min(caret.anchor.p, caret.focus.p), last: Math.max(caret.anchor.p, caret.focus.p) };
    }

    /*
     * The number each line shows (null for a line without one), worked out the
     * way the CSS counters of deckTextCss count: a numbered line at level N
     * counts on list-N and zeroes the deeper levels; any other line at level N
     * zeroes list-N and deeper.
     */
    function shownNumbers(lines) {
        const counters = [0, 0, 0, 0, 0, 0];   // index = level
        return lines.map((line) => {
            const level = levelOf(line);
            const isNumber = listOf(line) === 'number';
            if (isNumber) {
                const start = positiveInt(line.getAttribute('data-start'));
                counters[level] = start !== null ? start : counters[level] + 1;
            }
            for (let n = isNumber ? level + 1 : level; n <= MAX_LEVEL; n++) {
                counters[n] = 0;
            }
            return isNumber ? counters[level] : null;
        });
    }

    /* The number Continue gives line `index`: one more than the last numbered line before it at its level. */
    function continuedNumber(lines, index) {
        const numbers = shownNumbers(lines);
        const level = levelOf(lines[index]);
        for (let i = index - 1; i >= 0; i--) {
            if (numbers[i] !== null && levelOf(lines[i]) === level) {
                return numbers[i] + 1;
            }
        }
        return null;
    }

    const LIST_LABELS = { bullet: 'Bullets', number: 'Numbering', indent: 'Increase indent', outdent: 'Decrease indent',
        restart: 'Restart numbering', continue: 'Continue numbering' };

    /*
     * The action for a list button, or null when it cannot act here (no lines;
     * Restart/Continue without a numbered line; Continue with no earlier
     * numbered line at that level). command: bullet | number | indent | outdent
     * | restart | continue.
     */
    App.text.listAction = function listAction(element, command, caret) {
        const lines = textLines(element);
        if (lines.length === 0 || !LIST_LABELS[command]) {
            return null;
        }
        const { first, last } = selectedRange(element, caret);
        const selected = lines.slice(first, last + 1);
        const keepCaret = () => caret;
        const label = LIST_LABELS[command];

        if (command === 'bullet' || command === 'number') {
            // As in PowerPoint: if every selected line already has it, it comes off; otherwise all get it.
            const list = selected.every((line) => listOf(line) === command) ? 'none' : command;
            return { label: label, run: () => { selected.forEach((line) => setListType(line, list)); return keepCaret(); } };
        }
        if (command === 'indent' || command === 'outdent') {
            return { label: label, run: () => { shiftLevels(element, first, last, command === 'indent' ? 1 : -1); return keepCaret(); } };
        }
        const target = selected.find((line) => listOf(line) === 'number');
        if (!target) {
            return null;
        }
        const start = command === 'restart' ? 1 : continuedNumber(lines, lines.indexOf(target));
        if (start === null) {
            return null;
        }
        return { label: label, run: () => { target.setAttribute('data-start', String(start)); return keepCaret(); } };
    };

    /* Whether every selected line (every line, without a caret) is bulleted / numbered: the buttons show "on". */
    App.text.listState = function listState(element, caret) {
        const { first, last } = selectedRange(element, caret);
        const selected = textLines(element).slice(first, last + 1);
        const all = (list) => selected.length > 0 && selected.every((line) => listOf(line) === list);
        return { bullet: all('bullet'), number: all('number') };
    };

    // ---------------------------------------------------------------
    // Paragraph formatting
    // ---------------------------------------------------------------
    //
    // Alignment, line spacing and space before / after go on the selected lines'
    // own <p> style (text-align, line-height, margin-top, margin-bottom), or on
    // every line of a selected box. Enter copies them to the new line.

    const ALIGN_LABELS = { left: 'Align left', center: 'Center', right: 'Align right', justify: 'Justify' };
    const PARAGRAPH_LABELS = { 'line-height': 'Line spacing', 'margin-top': 'Space before', 'margin-bottom': 'Space after' };

    /* The action setting `property` to `value` on the selected lines (every line without a caret). */
    App.text.paragraphAction = function paragraphAction(element, property, value, caret) {
        const lines = textLines(element);
        const label = property === 'text-align' ? ALIGN_LABELS[value] : PARAGRAPH_LABELS[property];
        if (lines.length === 0 || !label) {
            return null;
        }
        const { first, last } = selectedRange(element, caret);
        return {
            label: label,
            run: () => {
                lines.slice(first, last + 1).forEach((line) => line.style.setProperty(property, value));
                return caret;
            },
        };
    };

    /*
     * The selected lines' { align, lineHeight (a multiple of the font size),
     * spaceBefore, spaceAfter (pt) }, as the browser shows them; null where
     * the lines differ.
     */
    App.text.paragraphState = function paragraphState(element, caret) {
        const view = element.ownerDocument.defaultView;
        const { first, last } = selectedRange(element, caret);
        const lines = textLines(element).slice(first, last + 1);
        if (!view || lines.length === 0) {
            return { align: null, lineHeight: null, spaceBefore: null, spaceAfter: null };
        }
        const round = (number) => (isNaN(number) ? null : Math.round(number * 100) / 100);
        const looks = lines.map((line) => {
            const computed = view.getComputedStyle(line);
            const align = { start: 'left', end: 'right', '-webkit-left': 'left', '-webkit-center': 'center',
                '-webkit-right': 'right' }[computed.textAlign] || computed.textAlign;
            return {
                align: align,
                lineHeight: round(parseFloat(computed.lineHeight) / parseFloat(computed.fontSize)),
                spaceBefore: round(parseFloat(computed.marginTop) * 0.75),
                spaceAfter: round(parseFloat(computed.marginBottom) * 0.75),
            };
        });
        const state = {};
        Object.keys(looks[0]).forEach((key) => {
            state[key] = looks.every((look) => look[key] === looks[0][key]) ? looks[0][key] : null;
        });
        return state;
    };

    // ---------------------------------------------------------------
    // Character formatting
    // ---------------------------------------------------------------
    //
    // Bold, italic … clear formatting (SPEC Phase 3, Toolbar), written without
    // document.execCommand, whose HTML differs between browsers. A line is read
    // as runs: pieces of text with one look { text, formats, styles, href }
    // (or { br }). The selected runs are changed and the line is written back;
    // normalize() then merges what can be merged. Like the list buttons, each
    // command is an action { label, run }.

    const TOGGLES = { bold: 'b', italic: 'i', underline: 'u', strikethrough: 's', superscript: 'sup', subscript: 'sub' };
    const STYLE_LABELS = { bold: 'Bold', italic: 'Italic', underline: 'Underline', strikethrough: 'Strikethrough',
        superscript: 'Superscript', subscript: 'Subscript', clear: 'Clear formatting', 'font-family': 'Font',
        'font-size': 'Font size', grow: 'Increase font size', shrink: 'Decrease font size', color: 'Font color',
        'background-color': 'Highlight' };
    // Commands that set a size: an empty line takes it too (its height, and what is typed there later).
    const SIZE_STYLES = ['font-size', 'grow', 'shrink'];
    // Commands an empty line takes on its own <p> (it has no text to carry them).
    const LINE_STYLES = SIZE_STYLES.concat(['color']);
    // The font size list (SPEC Phase 3, "Font sizes"); Increase / Decrease step through it.
    App.text.FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96];
    // Bold and italic can also come from the box itself (.el font-weight / font-style).
    const BOX_FORMATS = { b: ['font-weight', 'bold'], i: ['font-style', 'italic'] };
    const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;

    /*
     * Bold, italic and size (pt) as the browser shows them, or null in a document
     * that is not displayed. The size is that of the text around a superscript
     * (which the browser draws smaller), as PowerPoint shows it.
     */
    function shownLook(element) {
        const view = element.ownerDocument.defaultView;
        if (!view) {
            return null;
        }
        const computed = view.getComputedStyle(element);
        let sized = element;
        while ((tagOf(sized) === 'sup' || tagOf(sized) === 'sub') && sized.parentElement) {
            sized = sized.parentElement;
        }
        const points = parseFloat(view.getComputedStyle(sized).fontSize) * 0.75;
        return { b: parseInt(computed.fontWeight, 10) >= 600, i: /italic|oblique/.test(computed.fontStyle),
            size: Math.round(points * 2) / 2, family: computed.fontFamily, color: computed.color };
    }

    /* The next size in the list above (direction 1) or below (-1) `size`; the same size at the ends. */
    function stepSize(size, direction) {
        const sizes = App.text.FONT_SIZES;
        if (direction > 0) {
            const next = sizes.find((candidate) => candidate > size);
            return next !== undefined ? next : size;
        }
        const smaller = sizes.filter((candidate) => candidate < size);
        return smaller.length > 0 ? smaller[smaller.length - 1] : size;
    }

    /* A run's size in pt: its own, else what the browser shows. */
    function sizeOf(run) {
        const own = run.styles['font-size'] ? parseFloat(toPoints(run.styles['font-size'])) : NaN;
        return !isNaN(own) ? own : run.shown ? run.shown.size : null;
    }

    /* The size a command gives text (or an empty line) whose size is now `size`. */
    function newSize(style, value, size) {
        if (style === 'font-size') {
            return toPoints(value);
        }
        return size === null ? null : stepSize(size, style === 'grow' ? 1 : -1) + 'pt';
    }

    /* The runs of a line. Text without its own size or colour takes the line's (see derivedLook). */
    function readRuns(line) {
        const lineLook = spanStyles(line);
        const base = {};
        ['font-size', 'color'].forEach((property) => {
            if (lineLook[property]) {
                base[property] = lineLook[property];
            }
        });
        return inlineItems(line).map((item) => {
            if (item.nodeType !== Node.TEXT_NODE) {
                return { br: true };
            }
            const run = { text: item.data, formats: new Set(), styles: {}, href: null, shown: shownLook(item.parentElement) };
            for (let node = item.parentElement; node && node !== line; node = node.parentElement) {
                const tag = tagOf(node);
                if (TAG_FORMATS[tag]) {
                    run.formats.add(TAG_FORMATS[tag]);
                }
                styleFormats(node).forEach((format) => run.formats.add(format));
                if (tag === 'a' && run.href === null) {
                    run.href = node.getAttribute('href');
                }
                const own = spanStyles(node);
                Object.keys(own).forEach((property) => {
                    if (!(property in run.styles)) {
                        run.styles[property] = own[property];   // the innermost span wins
                    }
                });
            }
            Object.keys(base).forEach((property) => {
                if (!(property in run.styles)) {
                    run.styles[property] = base[property];
                }
            });
            return run;
        });
    }

    /* Write runs back as HTML (link > span > b > i > u > s > sup/sub, as normalize writes them). */
    function writeRuns(line, runs) {
        const doc = line.ownerDocument;
        const nodes = [];
        runs.forEach((run) => {
            if (run.br) {
                nodes.push(doc.createElement('br'));
                return;
            }
            if (run.text === '') {
                return;
            }
            let node = doc.createTextNode(run.text);
            FORMAT_TAGS.slice().reverse().forEach((format) => {
                if (run.formats.has(format)) {
                    node = wrap(doc.createElement(format), [node]);
                }
            });
            const style = styleText(run.styles, SPAN_ORDER);
            if (style) {
                const span = doc.createElement('span');
                span.setAttribute('style', style);
                node = wrap(span, [node]);
            }
            if (run.href) {
                const link = doc.createElement('a');
                link.setAttribute('href', run.href);
                node = wrap(link, [node]);
            }
            nodes.push(node);
        });
        line.replaceChildren(...nodes);
        if (runs.some((run) => !run.br && run.text !== '')) {
            // The runs carry the look now; normalize derives the line's own values again.
            line.style.removeProperty('font-size');
            line.style.removeProperty('color');
        }
    }

    function copyRun(run, text) {
        return { text: text, formats: new Set(run.formats), styles: Object.assign({}, run.styles), href: run.href, shown: run.shown };
    }

    /*
     * Split the runs of a line at start and end (character positions, a <br>
     * counting as one) and return { runs, selected }: the new list and the text
     * runs between start and end.
     */
    function sliceRuns(runs, start, end) {
        const out = [];
        const selected = [];
        let position = 0;
        runs.forEach((run) => {
            if (run.br) {
                out.push(run);
                position += 1;
                return;
            }
            const from = position;
            const to = position + run.text.length;
            position = to;
            const cuts = [from, Math.min(Math.max(start, from), to), Math.min(Math.max(end, from), to), to];
            for (let i = 0; i < 3; i++) {
                if (cuts[i + 1] > cuts[i]) {
                    const piece = copyRun(run, run.text.slice(cuts[i] - from, cuts[i + 1] - from));
                    out.push(piece);
                    if (i === 1) {
                        selected.push(piece);
                    }
                }
            }
        });
        return { runs: out, selected: selected };
    }

    /* The runs before and after position o of a line, split there (a <br> counts as one). */
    function splitRunsAt(runs, o) {
        const split = sliceRuns(runs, o, o).runs;
        let index = 0;
        let position = 0;
        while (index < split.length && position < o) {
            position += split[index].br ? 1 : split[index].text.length;
            index++;
        }
        return [split.slice(0, index), split.slice(index)];
    }

    function comparePositions(a, b) {
        return a.p !== b.p ? a.p - b.p : a.o - b.o;
    }

    /* The word around a cursor strictly inside it, as { start, end } in the line, else null. */
    function wordAround(line, o) {
        const text = readRuns(line).map((run) => run.br ? '\n' : run.text).join('');
        if (o <= 0 || o >= text.length || !WORD_CHAR_RE.test(text[o - 1]) || !WORD_CHAR_RE.test(text[o])) {
            return null;
        }
        let start = o;
        let end = o;
        while (start > 0 && WORD_CHAR_RE.test(text[start - 1])) {
            start--;
        }
        while (end < text.length && WORD_CHAR_RE.test(text[end])) {
            end++;
        }
        return { start: start, end: end };
    }

    /*
     * The parts of lines a formatting command works on: [{ index, start, end }].
     * No cursor: every line, whole. A cursor inside a word: that word. A cursor
     * anywhere else: null (the formatting is for what is typed next).
     */
    function formatSegments(element, caret) {
        const lines = textLines(element);
        if (!caret) {
            return lines.map((line, index) => ({ index: index, start: 0, end: Infinity }));
        }
        const ordered = [caret.anchor, caret.focus].sort(comparePositions);
        const [from, to] = ordered;
        if (comparePositions(from, to) === 0) {
            if (lines[from.p] && isEmptyLine(lines[from.p])) {
                return [{ index: from.p, start: 0, end: Infinity }];   // an empty line: the line itself
            }
            const word = lines[from.p] ? wordAround(lines[from.p], from.o) : null;
            return word ? [{ index: from.p, start: word.start, end: word.end }] : null;
        }
        const segments = [];
        for (let p = from.p; p <= Math.min(to.p, lines.length - 1); p++) {
            segments.push({ index: p, start: p === from.p ? from.o : 0, end: p === to.p ? to.o : Infinity });
        }
        return segments;
    }

    function hasFormat(run, format) {
        return run.formats.has(format) || (BOX_FORMATS[format] && run.shown ? run.shown[format] : false);
    }

    /*
     * When every piece of text in the box has the same bold or italic, it is
     * written on the box itself (the box's look, as after an import) instead
     * of on each piece.
     */
    function liftToBox(element, allRuns, lines) {
        const texts = allRuns.filter((run) => !run.br && run.text !== '');
        if (texts.length === 0) {
            return;
        }
        Object.keys(BOX_FORMATS).forEach((format) => {
            if (texts.every((run) => run.formats.has(format))) {
                element.style.setProperty(BOX_FORMATS[format][0], BOX_FORMATS[format][1]);
                texts.forEach((run) => run.formats.delete(format));
            }
        });
        // (Not the highlight: on the box it would colour the whole box, not the text.)
        ['font-family', 'font-size', 'color'].forEach((property) => {
            const value = texts[0].styles[property];
            if (value && texts.every((run) => run.styles[property] === value)) {
                if (property === 'font-size') {
                    // Empty lines that follow the box's size keep the one they have now.
                    lines.filter((line) => isEmptyLine(line) && !line.style.getPropertyValue('font-size')).forEach((line) => {
                        const look = shownLook(line);
                        if (look) {
                            line.style.setProperty('font-size', look.size + 'pt');
                        }
                    });
                }
                element.style.setProperty(property, value);
                texts.forEach((run) => { delete run.styles[property]; });
            }
        });
    }

    /* Changes the selected runs for one command; allRuns = every run of the box (bold can move off the box). */
    function changeRuns(element, style, value, selected, allRuns) {
        if (style === 'clear') {
            selected.forEach((run) => {
                run.formats.clear();
                run.styles = {};
            });
            return;
        }
        if (style === 'font-family' || style === 'color' || style === 'background-color') {
            selected.forEach((run) => {
                if (value) {
                    run.styles[style] = value;
                } else {
                    delete run.styles[style];   // highlight "No color"
                }
            });
            return;
        }
        if (SIZE_STYLES.indexOf(style) !== -1) {
            selected.forEach((run) => {
                const size = newSize(style, value, sizeOf(run));
                if (size) {
                    run.styles['font-size'] = size;
                }
            });
            return;
        }
        const format = TOGGLES[style];
        const turnOn = !selected.every((run) => hasFormat(run, format));
        if (turnOn) {
            selected.forEach((run) => {
                run.formats.add(format);
                if (format === 'sup' || format === 'sub') {
                    run.formats.delete(format === 'sup' ? 'sub' : 'sup');
                }
            });
            return;
        }
        moveOffBox(element, format, allRuns);
        selected.forEach((run) => run.formats.delete(format));
    }

    /* If the box itself is bold (or italic), that moves onto its text, so part of the text can lose it. */
    function moveOffBox(element, format, allRuns) {
        const box = shownLook(element);
        if (BOX_FORMATS[format] && box && box[format]) {
            element.style.setProperty(BOX_FORMATS[format][0], 'normal');
            allRuns.forEach((run) => {
                if (!run.br && run.shown && run.shown[format]) {
                    run.formats.add(format);
                }
            });
        }
    }

    /*
     * The action for a formatting command on the selection (caret), or on all
     * the text of the box (caret null); null when there is no text to change
     * there (a cursor outside a word: the editor keeps the formatting for what
     * is typed next). style: bold | italic | underline | strikethrough |
     * superscript | subscript | clear.
     */
    App.text.styleAction = function styleAction(element, style, value, caret) {
        if (!STYLE_LABELS[style]) {
            return null;
        }
        const segments = formatSegments(element, caret);
        if (!segments) {
            return null;
        }
        const lines = textLines(element);
        const selectedText = [];
        segments.forEach((segment) => {
            selectedText.push(...sliceRuns(readRuns(lines[segment.index]), segment.start, segment.end).selected);
        });
        const sizes = SIZE_STYLES.indexOf(style) !== -1;
        // Empty lines in the selection take a size or colour too (they have no text to carry it).
        const emptyLines = LINE_STYLES.indexOf(style) !== -1
            ? segments.map((segment) => lines[segment.index]).filter(isEmptyLine) : [];
        if (sizes && style !== 'font-size') {
            // Increase / Decrease at the end of the list change nothing: no undo step either.
            const changes = (size) => size !== null && parseFloat(newSize(style, value, size)) !== size;
            const lineSize = (line) => (shownLook(line) ? shownLook(line).size : null);
            if (!selectedText.some((run) => changes(sizeOf(run))) && !emptyLines.some((line) => changes(lineSize(line)))) {
                return null;
            }
        }
        if (selectedText.length === 0 && emptyLines.length === 0) {
            return null;
        }
        return {
            label: STYLE_LABELS[style],
            run: () => {
                // Read everything before changing anything: the box's look decides what the text shows.
                const perLine = lines.map((line) => readRuns(line));
                const emptyValues = emptyLines.map((line) => (style === 'color' ? value
                    : newSize(style, value, shownLook(line) ? shownLook(line).size : null)));
                const selected = [];
                segments.forEach((segment) => {
                    const sliced = sliceRuns(perLine[segment.index], segment.start, segment.end);
                    perLine[segment.index] = sliced.runs;
                    selected.push(...sliced.selected);
                });
                const allRuns = [].concat(...perLine);
                changeRuns(element, style, value, selected, allRuns);
                liftToBox(element, allRuns, lines);
                lines.forEach((line, index) => writeRuns(line, perLine[index]));
                emptyLines.forEach((line, index) => {
                    if (emptyValues[index]) {
                        line.style.setProperty(style === 'color' ? 'color' : 'font-size', emptyValues[index]);
                    }
                });
                return caret;
            },
        };
    };

    // ---------------------------------------------------------------
    // Change Case (Phase 10): the letters themselves change, as in PowerPoint
    // ---------------------------------------------------------------
    //
    // One character becomes one character, so every piece of formatting keeps
    // its place: the text nodes are rewritten where they are (a letter that
    // would become two, like ß in upper case, stays as it is). Words and
    // sentences are found in the whole line, so a range that starts mid-line
    // still knows whether its first letter starts a word.

    const CASE_LOCALE = 'pt-BR';
    const isLetter = (ch) => !!ch && ch.toLocaleLowerCase(CASE_LOCALE) !== ch.toLocaleUpperCase(CASE_LOCALE);
    const isWordChar = (ch) => isLetter(ch) || /[0-9'’]/.test(ch || '');

    function oneChar(ch, upper) {
        const changed = upper ? ch.toLocaleUpperCase(CASE_LOCALE) : ch.toLocaleLowerCase(CASE_LOCALE);
        return changed.length === 1 ? changed : ch;
    }

    /* Does a sentence start at `index` of `text`? At the start, or after . ! ? (and spaces). */
    function startsSentence(text, index) {
        let i = index - 1;
        while (i >= 0 && /\s/.test(text[i]) && text[i] !== '\n') {
            i--;
        }
        return i < 0 || text[i] === '\n' || /[.!?]/.test(text[i]);
    }

    /*
     * `text` with characters [start, end) in another case: 'upper', 'lower',
     * 'title' (Capitalize Each Word: first letter up, the rest down), 'sentence'
     * (Sentence case.) or 'toggle' (tOGGLE cASE). Same length as `text`.
     */
    App.text.changeCase = function changeCase(text, start, end, kind) {
        const chars = Array.from(text);   // whole characters (é is one), as the text nodes count them in UTF-16 below
        if (chars.length !== text.length) {
            return text;   // emoji / surrogate pairs: left as they are rather than shifting offsets
        }
        let sentenceOpen = startsSentence(text, start);
        for (let i = start; i < Math.min(end, chars.length); i++) {
            const ch = chars[i];
            if (kind === 'upper') {
                chars[i] = oneChar(ch, true);
            } else if (kind === 'lower') {
                chars[i] = oneChar(ch, false);
            } else if (kind === 'toggle') {
                chars[i] = oneChar(ch, ch === ch.toLocaleLowerCase(CASE_LOCALE));
            } else if (kind === 'title') {
                chars[i] = oneChar(ch, !isWordChar(text[i - 1]));
            } else if (kind === 'sentence') {
                if (/[.!?\n]/.test(ch)) {
                    sentenceOpen = true;
                    chars[i] = ch;
                } else if (isLetter(ch)) {
                    chars[i] = oneChar(ch, sentenceOpen && startsSentence(text, i));
                    sentenceOpen = false;
                }
            }
        }
        return chars.join('');
    };

    /* Shift+F3, as in Office: lowercase -> UPPERCASE -> Capitalize Each Word -> lowercase. */
    App.text.nextCase = function nextCase(text) {
        if (text === text.toLocaleLowerCase(CASE_LOCALE)) {
            return 'upper';
        }
        return text === text.toLocaleUpperCase(CASE_LOCALE) ? 'title' : 'lower';
    };

    const CASE_KINDS = ['sentence', 'lower', 'upper', 'title', 'toggle', 'cycle'];

    /* A line's text as the cursor counts it: a line break is one character. */
    function caretText(line) {
        return inlineItems(line).map((item) => (item.nodeType === Node.TEXT_NODE ? item.data : '\n')).join('');
    }

    /*
     * The action for Change Case (kind: one of CASE_KINDS; 'cycle' is Shift+F3)
     * on the selection, the word at the cursor, or every line of the box (caret
     * null); null when nothing would change.
     */
    App.text.caseAction = function caseAction(element, kind, caret) {
        const segments = CASE_KINDS.indexOf(kind) !== -1 ? formatSegments(element, caret) : null;
        if (!segments) {
            return null;
        }
        const lines = textLines(element);
        const texts = segments.map((segment) => caretText(lines[segment.index]));
        const chosen = kind === 'cycle'
            ? App.text.nextCase(segments.map((segment, i) => texts[i].slice(segment.start, segment.end)).join(''))
            : kind;
        const changed = segments.map((segment, i) => App.text.changeCase(texts[i], segment.start, segment.end, chosen));
        if (changed.every((text, i) => text === texts[i])) {
            return null;
        }
        return {
            label: 'Change case',
            run: () => {
                segments.forEach((segment, i) => {
                    let at = 0;
                    inlineItems(lines[segment.index]).forEach((item) => {
                        if (item.nodeType !== Node.TEXT_NODE) {
                            at += 1;
                            return;
                        }
                        const next = changed[i].slice(at, at + item.data.length);
                        if (next !== item.data) {
                            item.data = next;
                        }
                        at += item.data.length;
                    });
                });
                return caret;
            },
        };
    };

    /* Home > Font > Change Case (Aa) and Shift+F3, on the text being edited or the selected box. */
    App.text.applyCase = function applyCase(kind) {
        const target = listTarget();
        const action = target && App.text.caseAction(target.element, kind, target.caret);
        if (!action) {
            return;
        }
        pending = null;
        if (editing) {
            runInEditor(action);
        } else {
            runOnBox(target.element, action);
        }
    };

    // ---------------------------------------------------------------
    // Text layout (Phase 10): Align Text top / middle / bottom, inner margins
    // ---------------------------------------------------------------
    //
    // A text box is aligned to the middle or bottom by its own inline flex
    // column (display: flex; flex-direction: column; justify-content: center |
    // flex-end), the form the importer writes for a centred title
    // (keepVerticalAlignment); top is the plain box, with none of it. A shape's
    // text area is always such a column (shapes.TEXT_STYLE, middle when new).
    // Inner margins are the padding of the box, or of the shape's text area.

    const ANCHORS = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };

    /*
     * Where the text of a text box or shape sits: its own box, or the shape's
     * text area; null for neither. A shape with no text area yet: made when
     * `create`, else a stand-in with the new area's style, so reading changes nothing.
     */
    function layoutBox(element, create) {
        if (!element) {
            return null;
        }
        const type = element.getAttribute('data-type');
        if (type === 'text') {
            return element;
        }
        if (type !== 'shape' || !App.shapes.canHoldText(element)) {
            return null;
        }
        const area = App.shapes.textOf(element, { create: !!create });
        if (area) {
            return area;
        }
        const standIn = element.ownerDocument.createElement('div');
        standIn.setAttribute('style', App.shapes.TEXT_STYLE);
        return standIn;
    }

    /* A text box or a shape that can hold text: Align Text and margins apply. */
    App.text.canLayout = function canLayout(element) {
        return layoutBox(element, false) !== null;
    };

    /* 'top', 'middle' or 'bottom'. */
    App.text.anchorOf = function anchorOf(element) {
        const box = layoutBox(element);
        if (!box || box.style.display !== 'flex' || !/column/.test(box.style.flexDirection)) {
            return 'top';
        }
        const value = box.style.justifyContent;
        return value === 'center' ? 'middle' : (value === 'flex-end' || value === 'end') ? 'bottom' : 'top';
    };

    App.text.setAnchor = function setAnchor(element, anchor) {
        const box = layoutBox(element, true);
        if (!box || !ANCHORS[anchor]) {
            return;
        }
        const isShapeText = element.getAttribute('data-type') === 'shape';
        if (anchor === 'top' && !isShapeText) {
            ['display', 'flex-direction', 'justify-content', 'align-items'].forEach((name) => box.style.removeProperty(name));
            return;
        }
        box.style.setProperty('display', 'flex');
        box.style.setProperty('flex-direction', 'column');
        box.style.setProperty('justify-content', ANCHORS[anchor]);
        if (!isShapeText) {
            box.style.setProperty('align-items', 'stretch');   // the lines keep the box's full width
        }
    };

    /* The inner margins in slide px: { left, right, top, bottom } (the inline padding; 0 where none is set). */
    App.text.marginsOf = function marginsOf(element) {
        const box = layoutBox(element);
        const side = (name) => (box ? parseFloat(box.style.getPropertyValue('padding-' + name)) || 0 : 0);
        return { left: side('left'), right: side('right'), top: side('top'), bottom: side('bottom') };
    };

    App.text.setMargins = function setMargins(element, margins) {
        const box = layoutBox(element, true);
        if (!box) {
            return;
        }
        ['left', 'right', 'top', 'bottom'].forEach((name) => {
            if (typeof margins[name] === 'number' && margins[name] >= 0) {
                box.style.setProperty('padding-' + name, App.util.round2(margins[name]) + 'px');
            }
        });
    };

    /* The text boxes and shapes Align Text and margins act on: the one being typed in, else the selected ones. */
    function layoutTargets() {
        if (editing) {
            const owner = editing.element.matches('.el') ? editing.element : editing.element.closest('.el[data-type="shape"]');
            return owner && App.text.canLayout(owner) ? [owner] : [];
        }
        return App.selection.getElements().filter(App.text.canLayout);
    }

    App.text.canApplyLayout = function canApplyLayout() {
        return layoutTargets().length > 0;
    };

    /* What the ribbon and the Format pane show: the first target's { anchor, margins }, or null. */
    App.text.layoutState = function layoutState() {
        const first = layoutTargets()[0];
        return first ? { anchor: App.text.anchorOf(first), margins: App.text.marginsOf(first) } : null;
    };

    /* `change(element)` on every target, as one undo step; the text being typed in keeps its cursor. */
    function applyLayout(label, change) {
        const targets = layoutTargets();
        if (!targets.length) {
            return;
        }
        if (editing) {
            const element = editing.element;
            runInEditor({ label: label, run: () => {
                const caret = App.text.getCaret(element);
                targets.forEach(change);
                return caret;
            } });
            return;
        }
        App.history.change(label, { slideId: App.deck.getCurrentSlide().getAttribute('data-slide-id') }, () => {
            targets.forEach((target) => {
                change(target);
                App.text.fitText(target);   // new margins: an autofit box fits its text again
            });
        });
        App.selection.refresh();
    }

    /* Home > Paragraph > Align Text: 'top', 'middle' or 'bottom'. */
    App.text.applyAnchor = function applyAnchor(anchor) {
        applyLayout('Align text', (element) => App.text.setAnchor(element, anchor));
    };

    /* The Format pane's inner margins (some or all of { left, right, top, bottom }, slide px). */
    App.text.applyMargins = function applyMargins(margins) {
        applyLayout('Text margins', (element) => App.text.setMargins(element, margins));
    };

    /*
     * What the selected text has, for the ribbon: { bold, italic, underline,
     * strikethrough, superscript, subscript } (true when every selected
     * character has it). A cursor shows the character before it.
     */
    App.text.styleState = function styleState(element, caret) {
        const lines = textLines(element);
        let runs = [];
        if (!caret) {
            runs = [].concat(...lines.map(readRuns)).filter((run) => !run.br);   // text only, not line breaks
        } else {
            const [from, to] = [caret.anchor, caret.focus].sort(comparePositions);
            for (let p = from.p; p <= Math.min(to.p, lines.length - 1); p++) {
                const start = p === from.p ? from.o : 0;
                const end = p === to.p ? to.o : Infinity;
                runs.push(...sliceRuns(readRuns(lines[p]), start, end).selected);
            }
            if (runs.length === 0 && lines[from.p]) {
                const lineRuns = readRuns(lines[from.p]);
                const at = from.o > 0 ? sliceRuns(lineRuns, from.o - 1, from.o) : sliceRuns(lineRuns, 0, 1);
                runs = at.selected;
            }
        }
        const state = {};
        Object.keys(TOGGLES).forEach((style) => {
            state[style] = runs.length > 0 && runs.every((run) => hasFormat(run, TOGGLES[style]));
        });
        if (runs.length === 0) {
            // An empty line: the box's own bold / italic, the line's size.
            const box = shownLook(element);
            state.bold = !!(box && box.b);
            state.italic = !!(box && box.i);
            const line = caret ? lines[Math.min(caret.focus.p, lines.length - 1)] : null;
            const look = line ? shownLook(line) : null;
            state.fontSize = look ? look.size : null;
        } else {
            const sizes = runs.map(sizeOf);
            state.fontSize = sizes.every((size) => size === sizes[0]) ? sizes[0] : null;
        }
        // The font as written (a theme font stays "var(--font-body)"), else as the browser has it.
        const boxFont = element.style.getPropertyValue('font-family') ||
            (element.ownerDocument.defaultView ? element.ownerDocument.defaultView.getComputedStyle(element).fontFamily : null);
        const fonts = (runs.length > 0 ? runs : [{ styles: {} }]).map((run) => run.styles['font-family'] || boxFont);
        state.fontFamily = fonts.every((font) => font === fonts[0]) ? fonts[0] : null;
        return state;
    };

    // ---------------------------------------------------------------
    // Paste
    // ---------------------------------------------------------------
    //
    // Ctrl+V: the clipboard's structure and basic formatting (bold, italic,
    // underline, lists and levels, links) in the look of the text where it
    // lands ("Use Destination Theme"); text copied in the editor keeps all its
    // formatting. Ctrl+Shift+V ('plain'): the plain text only. The first pasted
    // line joins the line at the cursor, the rest of that line follows the last.

    /* A line's runs, without the <br> that only keeps an empty line open. */
    function contentRuns(line) {
        return isEmptyLine(line) ? [] : readRuns(line);
    }

    function runsLength(runs) {
        return runs.reduce((sum, run) => sum + (run.br ? 1 : run.text.length), 0);
    }

    /*
     * The pasted lines: { list, level, start, style, runs, keep, plain }. list
     * and level null: the line takes those of the line it lands in (plain text
     * pasted into a bullet becomes bullets). keep: text copied in the editor,
     * pasted as it was.
     */
    function pastedLines(clipboard, mode) {
        if (mode !== 'plain' && clipboard.html) {
            const { fromEditor, holder } = App.clipboard.toParagraphs(clipboard.html);
            const lines = textLines(holder).map((p) => {
                const list = listOf(p);
                const level = levelOf(p);
                const start = list === 'number' ? positiveInt(p.getAttribute('data-start')) : null;
                const runs = contentRuns(p);
                if (fromEditor) {
                    return { list: list, level: level, start: start, style: paragraphStyles(p), runs: runs, keep: true };
                }
                const plainLine = list === 'none' && level === 1;
                return { list: plainLine ? null : list, level: plainLine ? null : level, start: start, runs: runs };
            });
            if (lines.some((line) => line.runs.length > 0)) {
                return lines;
            }
        }
        const text = (clipboard.text || '').replace(/\r\n?/g, '\n').replace(/\n$/, '');
        if (text === '') {
            return [];
        }
        return text.split('\n').map((line) => {
            const clean = line.replace(LIST_SYMBOL_RE, '').replace(/\t/g, ' ');
            return { list: null, level: null, start: null, plain: true,
                runs: clean === '' ? [] : [{ text: clean, formats: new Set(), styles: {}, href: null, shown: null }] };
        });
    }

    // Word's plain text starts list lines with its bullet symbol and a tab ("•\tText", "o\tText", a
    // Symbol/Wingdings character from U+F000-U+F0FF that other fonts show as an empty box). Numbers
    // ("1.\t", "a.\t") stay: they mean something.
    const LIST_SYMBOL_RE = /^[ \u00a0]*[\u2022\u00b7\u25aa\u25cf\u25e6\u25a0\u2013\u2023\u00a7o\uf000-\uf0ff][ \u00a0]*\t/;

    /* The look of the text at position o (the character before it, else after it, else the line's own). */
    function lookAt(line, runs, o) {
        const before = o > 0 ? sliceRuns(runs, o - 1, o).selected[0] : null;
        const model = before || sliceRuns(runs, o, o + 1).selected[0];
        if (model) {
            return { formats: model.formats, styles: model.styles };
        }
        const own = spanStyles(line);
        const styles = {};
        ['font-size', 'color'].forEach((property) => {
            if (own[property]) {
                styles[property] = own[property];
            }
        });
        return { formats: new Set(), styles: styles };
    }

    /* Remove the selected text (joining its first and last line); returns where it was. */
    function deleteSelection(element, caret) {
        const [from, to] = [caret.anchor, caret.focus].sort(comparePositions);
        if (comparePositions(from, to) === 0) {
            return from;
        }
        const lines = textLines(element);
        const [head] = splitRunsAt(contentRuns(lines[from.p]), from.o);
        const [, tail] = splitRunsAt(contentRuns(lines[to.p]), to.o);
        writeRuns(lines[from.p], head.concat(tail));
        lines.slice(from.p + 1, to.p + 1).forEach((line) => line.remove());
        return from;
    }

    /* Give a line the list type, level and start of a pasted line (and, from the editor, its paragraph look). */
    function takeParagraph(line, item) {
        line.setAttribute('data-list', item.list);
        line.setAttribute('data-level', String(item.level));
        if (item.start) {
            line.setAttribute('data-start', String(item.start));
        } else {
            line.removeAttribute('data-start');
        }
        if (item.keep) {
            ['text-align', 'line-height', 'margin-top', 'margin-bottom'].forEach((property) => {
                line.style.removeProperty(property);
                if (item.style[property]) {
                    line.style.setProperty(property, item.style[property]);
                }
            });
        }
    }

    /* The action pasting clipboard { html, text } at the caret; mode 'normal' or 'plain'; null if nothing to paste. */
    App.text.pasteAction = function pasteAction(element, caret, clipboard, mode) {
        const pasted = pastedLines(clipboard, mode);
        if (pasted.length === 0 || !caret || textLines(element).length === 0) {
            return null;
        }
        return {
            label: mode === 'plain' ? 'Paste as text' : 'Paste',
            run: () => {
                const at = deleteSelection(element, caret);
                const line = textLines(element)[at.p];
                const runs = contentRuns(line);
                const look = lookAt(line, runs, at.o);
                pasted.forEach((item) => item.runs.forEach((run) => {
                    if (run.br || item.keep) {
                        return;
                    }
                    if (item.plain) {
                        run.formats = new Set(look.formats);   // plain text: as if typed here
                    }
                    run.styles = Object.assign({}, look.styles);
                }));
                const [head, tail] = splitRunsAt(runs, at.o);
                const destination = line.cloneNode(false);
                destination.removeAttribute('data-start');   // a start number belongs to the first line only
                if (head.length === 0 && tail.length === 0 && pasted[0].list !== null) {
                    takeParagraph(line, pasted[0]);   // an empty line takes the first pasted line's list type
                }
                let current = line;
                let currentRuns = head.concat(pasted[0].runs);
                pasted.slice(1).forEach((item) => {
                    writeRuns(current, currentRuns);
                    const next = destination.cloneNode(false);
                    if (item.list !== null) {
                        takeParagraph(next, item);
                    }
                    current.after(next);
                    current = next;
                    currentRuns = item.runs;
                });
                const end = runsLength(currentRuns);
                writeRuns(current, currentRuns.concat(tail));
                return caretAt({ p: textLines(element).indexOf(current), o: end });
            },
        };
    };

    // ---------------------------------------------------------------
    // Copy and cut
    // ---------------------------------------------------------------
    //
    // Ctrl+C / Ctrl+X while typing put the selection on the clipboard as
    // nested lists (clipboard.fromLines) with each piece's full look, so it
    // looks the same in Outlook, Word or another text box, plus plain lines.

    const THEME_ATTRIBUTES = { 'font-family': 'data-theme-font', color: 'data-theme-color', 'background-color': 'data-theme-highlight' };

    /* A run with its whole look written on it: its own, else the box's declared one (theme variables kept), else as shown. */
    function fullLook(element, run) {
        const look = copyRun(run, run.text);
        if (run.shown) {
            ['b', 'i'].forEach((format) => {
                if (run.shown[format]) {
                    look.formats.add(format);
                }
            });
        }
        [['font-family', 'family'], ['font-size', 'size'], ['color', 'color']].forEach(([property, shown]) => {
            if (!look.styles[property]) {
                const declared = element.style.getPropertyValue(property);
                const value = declared && property !== 'font-size' ? declared
                    : run.shown ? (property === 'font-size' ? run.shown.size + 'pt' : run.shown[shown]) : null;
                if (value) {
                    look.styles[property] = value;
                }
            }
        });
        return look;
    }

    /* For programs that do not know the theme: var(--x) written out, its name kept in a data-theme-… attribute. */
    function resolveThemeValues(line) {
        const root = line.ownerDocument.documentElement;
        const view = line.ownerDocument.defaultView;
        line.querySelectorAll('span').forEach((span) => {
            Object.keys(THEME_ATTRIBUTES).forEach((property) => {
                const match = /^var\((--[a-z0-9-]+)\)$/.exec(span.style.getPropertyValue(property));
                const value = match && view ? view.getComputedStyle(root).getPropertyValue(match[1]).trim() : '';
                if (value) {
                    span.style.setProperty(property, value);
                    span.setAttribute(THEME_ATTRIBUTES[property], match[1]);
                }
            });
        });
    }

    /* The selection as { html, text } for the clipboard, or null when nothing is selected. */
    App.text.copyContent = function copyContent(element, caret) {
        if (!caret || sameCaret(caret)) {
            return null;
        }
        const [from, to] = [caret.anchor, caret.focus].sort(comparePositions);
        const lines = textLines(element);
        const numbers = shownNumbers(lines);
        const copiedLines = [];
        const texts = [];
        for (let p = from.p; p <= Math.min(to.p, lines.length - 1); p++) {
            const line = lines[p];
            const runs = contentRuns(line);
            const [, rest] = splitRunsAt(runs, p === from.p ? from.o : 0);
            const [part] = p === to.p ? splitRunsAt(rest, to.o - (p === from.p ? from.o : 0)) : [rest];
            const holder = line.cloneNode(false);
            writeRuns(holder, part.map((run) => (run.br ? run : fullLook(element, run))));
            resolveThemeValues(holder);
            const style = styleText(paragraphStyles(line), PARAGRAPH_ORDER);
            copiedLines.push({ list: listOf(line), level: levelOf(line), number: numbers[p], style: style, html: holder.innerHTML,
                start: listOf(line) === 'number' ? positiveInt(line.getAttribute('data-start')) : null });
            texts.push(part.map((run) => (run.br ? '\n' : run.text)).join(''));
        }
        return { html: App.clipboard.fromLines(copiedLines, element.ownerDocument), text: texts.join('\n') };
    };

    /* Ctrl+X: the selection is removed (copyContent has put it on the clipboard). */
    App.text.cutAction = function cutAction(element, caret) {
        if (!caret || sameCaret(caret)) {
            return null;
        }
        return { label: 'Cut', run: () => caretAt(deleteSelection(element, caret)) };
    };

    // ---------------------------------------------------------------
    // Format painter
    // ---------------------------------------------------------------
    //
    // pickLook takes the whole look of one character (its own formatting, else
    // the box's, else what the browser shows) and of its line (alignment,
    // spacing); lookAction gives it to other text. Lines painted whole also get
    // the paragraph look; a word or part of a line only the character look.

    /* The look at the cursor (the character before it), the selection's first character, or a box's first text. */
    App.text.pickLook = function pickLook(element, caret) {
        const lines = textLines(element);
        let line;
        let run = null;
        if (!caret) {
            line = lines.find((candidate) => !isEmptyLine(candidate)) || lines[0];
            run = line ? contentRuns(line).find((candidate) => !candidate.br) : null;
        } else {
            const [from, to] = [caret.anchor, caret.focus].sort(comparePositions);
            line = lines[from.p];
            const runs = line ? contentRuns(line) : [];
            if (comparePositions(from, to) !== 0) {
                run = sliceRuns(runs, from.o, from.p === to.p ? to.o : Infinity).selected[0] || null;
            }
            run = run || (from.o > 0 ? sliceRuns(runs, from.o - 1, from.o).selected[0] : null) ||
                sliceRuns(runs, from.o, from.o + 1).selected[0] || null;
        }
        if (!line) {
            return null;
        }
        // An empty line: the look it keeps for what is typed into it.
        const source = run || { text: '', formats: new Set(), styles: lookAt(line, [], 0).styles, href: null, shown: shownLook(line) };
        const full = fullLook(element, source);
        const paragraph = paragraphStyles(line);
        ['text-align', 'line-height'].forEach((property) => {
            if (!paragraph[property] && element.style.getPropertyValue(property)) {
                paragraph[property] = element.style.getPropertyValue(property);   // the box's, when the line has none
            }
        });
        const styles = {};
        Object.keys(full.styles).filter((property) => SPAN_ORDER.indexOf(property) !== -1).forEach((property) => {
            styles[property] = full.styles[property];
        });
        return { formats: FORMAT_TAGS.filter((format) => full.formats.has(format)), styles: styles, paragraph: paragraph };
    };

    /* The action giving `look` (from pickLook) to the selection, the word at the cursor, or the whole box (caret null). */
    App.text.lookAction = function lookAction(element, caret, look) {
        const segments = formatSegments(element, caret);
        if (!segments || !look) {
            return null;
        }
        const lines = textLines(element);
        return {
            label: 'Format painter',
            run: () => {
                const perLine = lines.map((line) => readRuns(line));
                const selected = [];
                const wholeLines = [];
                segments.forEach((segment) => {
                    const line = lines[segment.index];
                    if (segment.start === 0 && segment.end >= lineLength(line)) {
                        wholeLines.push(line);
                    }
                    const sliced = sliceRuns(perLine[segment.index], segment.start, segment.end);
                    perLine[segment.index] = sliced.runs;
                    selected.push(...sliced.selected);
                });
                const allRuns = [].concat(...perLine);
                if (selected.length > 0) {
                    Object.keys(BOX_FORMATS).filter((format) => look.formats.indexOf(format) === -1)
                        .forEach((format) => moveOffBox(element, format, allRuns));
                }
                // What the box itself already has need not be repeated on its text.
                const styles = {};
                Object.keys(look.styles).forEach((property) => {
                    if (element.style.getPropertyValue(property) !== look.styles[property]) {
                        styles[property] = look.styles[property];
                    }
                });
                selected.forEach((run) => {
                    run.formats = new Set(look.formats);
                    run.styles = Object.assign({}, styles);
                });
                liftToBox(element, allRuns, lines);
                lines.forEach((line, index) => writeRuns(line, perLine[index]));
                wholeLines.forEach((line) => {
                    Object.keys(look.paragraph).forEach((property) => line.style.setProperty(property, look.paragraph[property]));
                    if (isEmptyLine(line)) {
                        ['font-size', 'color'].forEach((property) => {
                            if (look.styles[property]) {
                                line.style.setProperty(property, look.styles[property]);
                            }
                        });
                    }
                });
                return caret;
            },
        };
    };

    /* Run an action (a key, AutoFormat, a list button): change the lines, tidy them, put the cursor back
       (an action on a selected box, not being edited, has no cursor). */
    App.text.runAction = function runAction(element, action) {
        const caret = action.run();
        App.text.normalize(element);
        if (caret) {
            App.text.setCaret(element, caret);
        }
    };

    // ---------------------------------------------------------------
    // Find & replace (SPEC Phase 3; the panel is findreplace.js)
    // ---------------------------------------------------------------
    //
    // A match is { p, start, end }: line p, characters [start, end), counted
    // like the cursor (a <br> counts as one), so it can be selected with setCaret.

    const WORD_EDGE = '[\\p{L}\\p{N}_]';

    /* A line's text as the cursor counts it: a <br> is one "\n", which no search can cross. */
    function lineText(line) {
        return inlineItems(line).map((item) => (item.nodeType === Node.TEXT_NODE ? item.data : '\n')).join('');
    }

    /* The search as a regular expression: the text literally, a space also finding a non-breaking one. */
    function searchPattern(query, options) {
        const body = Array.from(query).map((ch) => (ch === ' ' || ch === ' ' ? '[  ]'
            : ch.replace(/[\^$\\.*+?()[\]{}|/]/, '\\$&'))).join('');
        const pattern = options.wholeWord ? '(?<!' + WORD_EDGE + ')' + body + '(?!' + WORD_EDGE + ')' : body;
        return new RegExp(pattern, options.matchCase ? 'gu' : 'giu');
    }

    /*
     * Every match of `query` in a text box, line by line. options: { matchCase,
     * wholeWord } (both off by default). Accents count: "acao" does not find "ação".
     */
    App.text.findMatches = function findMatches(element, query, options) {
        if (!query) {
            return [];
        }
        const pattern = searchPattern(query, options || {});
        const matches = [];
        Array.from(element.children).forEach((line, p) => {
            for (const found of lineText(line).matchAll(pattern)) {
                matches.push({ p: p, start: found.index, end: found.index + found[0].length });
            }
        });
        return matches;
    };

    /* A DOM Range over a match (the find panel paints these with the CSS Highlight API). */
    App.text.matchRange = function matchRange(element, match) {
        const start = pointOf(element, { p: match.p, o: match.start });
        const end = pointOf(element, { p: match.p, o: match.end });
        const range = element.ownerDocument.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        return range;
    };

    /*
     * Replace matches of one box by `replacement`: each takes the formatting of
     * its first character (as in PowerPoint). run() returns the cursor after the
     * first replacement. null when there is nothing to replace.
     */
    App.text.replaceAction = function replaceAction(element, matches, replacement) {
        if (matches.length === 0) {
            return null;
        }
        return {
            label: 'Replace',
            run: () => {
                const lines = Array.from(element.children);
                const byLine = new Map();
                matches.forEach((match) => byLine.set(match.p, (byLine.get(match.p) || []).concat([match])));
                byLine.forEach((lineMatches, p) => {
                    let runs = readRuns(lines[p]);
                    // From the end of the line back, so the positions of the earlier matches stay right.
                    lineMatches.slice().sort((a, b) => b.start - a.start).forEach((match) => {
                        const sliced = sliceRuns(runs, match.start, match.end);
                        if (sliced.selected.length > 0) {
                            sliced.selected[0].text = replacement;
                            sliced.selected.slice(1).forEach((run) => {
                                run.text = '';
                            });
                        }
                        runs = sliced.runs.filter((run) => run.br || run.text !== '');
                    });
                    writeRuns(lines[p], runs);
                });
                const first = matches.reduce((a, b) => (comparePositions({ p: b.p, o: b.start }, { p: a.p, o: a.start }) < 0 ? b : a));
                return caretAt({ p: first.p, o: first.start + replacement.length });
            },
        };
    };

    /* Replace matches in a box with no undo step of its own and no cursor (Replace All makes one step of them all). */
    App.text.replaceAll = function replaceAll(element, matches, replacement) {
        const action = App.text.replaceAction(element, matches, replacement);
        if (action) {
            action.run();
            App.text.normalize(element);
        }
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
    let editing = null;   // { element, id, slideId, isNew, doc, textBefore (a cell's text when editing began) }
    let typing = null;    // { meta, timer } while a typing step is open
    let applying = false; // a key action is changing the text: its own input events are not typing
    let pending = null;   // { caret, styles: [] }: formatting chosen at a cursor, for the text typed next
    let looseSpace = null; // { node, index }: a non-breaking space insertStyled typed at the end of a line
    let plainPaste = false; // Ctrl+Shift+V was pressed: the paste that follows is plain text
    let painter = null;     // the format painter while it is on: { look, locked }
    let emptyNewBox = null; // { element, slideId }: a new box left empty, removed once it is deselected
    let lastPaste = null;   // the last paste, for the paste options button: { id, clipboard, mode, caret, end, state }

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
        if (!element.getAttribute('class')) {
            element.removeAttribute('class');   // a cell had none: no class="" left behind
        }
    }

    function overlayElement() {
        return document.getElementById('overlay');
    }

    /*
     * Start editing `element`: a text box, or a table cell (the table stays the
     * selected element). options.point { x, y } (slide px) puts the cursor where
     * the user clicked; options.caret 'start', 'all' (all its text selected, as
     * Tab into a cell does) or (default) the end. options.isNew: a box just
     * inserted, removed again if left empty.
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
        const stillNew = emptyNewBox !== null && emptyNewBox.element === element;
        if (stillNew) {
            emptyNewBox = null;   // typing in it again: it is the editing box's "new" again
        }
        editing = {
            element: element, id: App.text.containerKey(element), doc: doc, isNew: !!settings.isNew || stillNew,
            slideId: element.closest('section.slide').getAttribute('data-slide-id'),
            textBefore: isCell(element) ? App.text.lineTexts(element).join('\n') : null,
        };
        if (!doc.documentElement.getAttribute('lang')) {
            doc.documentElement.setAttribute('lang', 'pt-BR');   // spell check in Portuguese (SPEC Phase 3)
        }
        doc.execCommand('defaultParagraphSeparator', false, 'p');
        attachToElement(element);
        doc.addEventListener('keydown', onKeyDown, true);
        doc.addEventListener('pointerdown', onDeckPointerDown, true);
        doc.addEventListener('pointerup', onDeckPointerUp, true);
        doc.addEventListener('selectionchange', onSelectionChange);
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
        element.addEventListener('paste', onPaste);
        element.addEventListener('copy', onCopy);
        element.addEventListener('cut', onCopy);
    }

    function detachFromElement(element) {
        element.removeEventListener('beforeinput', onBeforeInput);
        element.removeEventListener('input', onInput);
        element.removeEventListener('paste', onPaste);
        element.removeEventListener('copy', onCopy);
        element.removeEventListener('cut', onCopy);
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
        const start = { p: 0, o: 0 };
        const caret = { start: caretAt(start), all: { anchor: start, focus: END_OF_TEXT.focus } }[settings.caret];
        App.text.setCaret(element, caret || END_OF_TEXT);
    }

    /*
     * Leave edit mode: the typing step is closed, the text normalized, and a new
     * box left empty is removed. options.select (default true) keeps the box selected.
     */
    App.text.exitEdit = function exitEdit(options) {
        if (!editing) {
            return;
        }
        const state = editing;
        if (state.textBefore !== null && state.element.isConnected &&
            App.text.lineTexts(state.element).join('\n') !== state.textBefore) {
            // As in Excel, a column of numbers lines up on the right once its cell is left
            // (before the typing step closes, so the step holds it).
            App.tables.alignNumbers(state.element.closest('table'));
        }
        App.text.commitTyping();
        editing = null;
        pending = null;
        state.doc.removeEventListener('keydown', onKeyDown, true);
        state.doc.removeEventListener('pointerdown', onDeckPointerDown, true);
        state.doc.removeEventListener('pointerup', onDeckPointerUp, true);
        state.doc.removeEventListener('selectionchange', onSelectionChange);
        window.removeEventListener('pointerdown', onEditorPointerDown, true);
        overlayElement().classList.remove('editing');
        const element = state.element;
        if (element.isConnected) {
            detachFromElement(element);
            if (isInner(element)) {
                App.text.normalizeCell(element);
            } else {
                App.text.normalize(element);
            }
            App.text.fitBox(element);
            element.blur();
            state.doc.getSelection().removeAllRanges();
            const keepSelected = !options || options.select !== false;
            if (state.isNew && element.textContent.trim() === '') {
                // As in PowerPoint, an empty new box goes once it is no longer selected, not
                // when typing stops (a ribbon command may end typing and still work on it).
                emptyNewBox = { element: element, slideId: state.slideId };
                if (!keepSelected) {
                    removeEmptyNewBox();
                }
            }
            if (keepSelected && element.isConnected) {
                App.selection.select(boxOf(element));
            }
        }
        window.focus();
        App.events.emit('text-edit-changed', { editing: false, id: state.id });
    };

    /* The cursor moved: the ribbon shows what the lines under it have (once per frame at most). */
    let selectionFrame = 0;
    function onSelectionChange() {
        if (pending && editing) {
            const caret = App.text.getCaret(editing.element);
            if (!caret || !sameCaret(caret) || comparePositions(caret.focus, pending.caret.focus) !== 0) {
                pending = null;
            }
        }
        if (!selectionFrame) {
            selectionFrame = requestAnimationFrame(() => {
                selectionFrame = 0;
                if (editing) {
                    App.events.emit('text-selection-changed');
                }
            });
        }
    }

    /* Remove the new box left empty, unless it got text meanwhile (or an undo took it away already). */
    function removeEmptyNewBox() {
        const box = emptyNewBox;
        emptyNewBox = null;
        if (box && box.element.isConnected && box.element.textContent.trim() === '') {
            App.history.change('Delete empty text box', { slideId: box.slideId }, () => box.element.remove());
        }
    }

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
        if (applying) {
            return;
        }
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
        if (pending && event.inputType === 'insertText' && event.data && !event.isComposing) {
            const caret = App.text.getCaret(editing.element);
            if (caret && sameCaret(caret) && comparePositions(caret.focus, pending.caret.focus) === 0) {
                event.preventDefault();   // typed here by insertStyled instead, with the chosen formatting
                insertStyled(editing.element, caret.focus, event.data, pending.styles);
                pending = null;
                if (App.text.fitBox(editing.element)) {
                    App.selection.refresh();
                }
            }
        }
    }

    /*
     * Type `text` at position `at` with the look of the character before it,
     * changed by `styles` (the formatting chosen at the cursor), and put the
     * cursor after it: the browser then types on inside the same formatting.
     */
    function insertStyled(element, at, typed, styles) {
        let text = typed;
        const lines = textLines(element);
        const perLine = lines.map((line) => readRuns(line));
        const runs = perLine[at.p];
        const before = at.o > 0 ? sliceRuns(runs, at.o - 1, at.o).selected[0] : null;
        const after = sliceRuns(runs, at.o, at.o + 1).selected[0];
        // Like the browser: a space at the end of a line, or next to another space, is a
        // non-breaking one, else it would be dropped as layout whitespace.
        if ((!after || / $/.test(before ? before.text : '') || /^ /.test(after.text) || at.o === 0) && / /.test(text)) {
            text = text.replace(/ /g, '\u00a0');
        }
        const model = before || after;
        const run = model ? copyRun(model, text) : { text: text, formats: new Set(), styles: spanStyles(lines[at.p]),
            href: null, shown: shownLook(lines[at.p]) };
        const [head, tail] = splitRunsAt(runs, at.o);
        perLine[at.p] = head.concat([run], tail);
        const allRuns = [].concat(...perLine);
        styles.forEach(([style, value]) => changeRuns(element, style, value, [run], allRuns));
        liftToBox(element, allRuns, lines);
        lines.forEach((line, i) => writeRuns(line, perLine[i]));
        App.text.normalize(element);
        App.text.setCaret(element, caretAt({ p: at.p, o: at.o + text.length }));
        const end = pointOf(element, { p: at.p, o: at.o + text.length });
        looseSpace = end.node.nodeType === Node.TEXT_NODE && end.node.data[end.offset - 1] === '\u00a0' && / $/.test(typed)
            ? { node: end.node, index: end.offset - 1 } : null;
    }

    function onInput(event) {
        const element = editing && editing.element;
        if (!element || applying) {
            return;
        }
        if (looseSpace) {
            // Text came after that space: it becomes a normal one again (as the browser does with its own).
            const { node, index } = looseSpace;
            looseSpace = null;
            if (node.isConnected && node.data[index] === '\u00a0' && /\S/.test(node.data[index + 1] || '')) {
                node.replaceData(index, 1, ' ');
            }
        }
        ensureLines(element);
        if (event.inputType === 'insertText' && /[ \u00a0]$/.test(event.data || '')) {
            const format = App.text.autoFormatAction(element);
            if (format) {
                runInEditor(format);   // its own undo step, after the typed "- "
            }
        }
        if (App.text.fitBox(element)) {
            App.selection.refresh();
        }
    }

    /* Ctrl+V / Ctrl+Shift+V while typing: the editor pastes (pasteAction), never the browser. */
    function onPaste(event) {
        if (!editing) {
            return;
        }
        event.preventDefault();
        const mode = plainPaste ? 'plain' : 'normal';
        plainPaste = false;
        const clipboard = { html: event.clipboardData.getData('text/html'), text: event.clipboardData.getData('text/plain') };
        const pictures = App.images.picturesIn(event.clipboardData);
        if (mode === 'normal' && pictures.length > 0 && !clipboard.text.trim()) {
            App.text.exitEdit({ select: false });   // a screenshot pasted while typing: its own picture on the slide
            App.images.insertFiles(pictures, 'Paste');
            return;
        }
        if (mode === 'normal' && isCell(editing.element) && App.tablePaste.pasteIntoCell(editing.element, clipboard)) {
            return;   // several cells from Excel: they fill the table from this cell on
        }
        const caret = App.text.getCaret(editing.element);
        const action = caret && App.text.pasteAction(editing.element, caret, clipboard, mode);
        if (action) {
            runInEditor(action);
            rememberPaste({ id: editing.id, clipboard: clipboard, mode: mode, caret: caret });
        }
    }

    function rememberPaste(paste) {
        lastPaste = Object.assign(paste, { state: App.history.stateId(), end: App.text.getCaret(editing.element) });
        App.events.emit('text-pasted');
    }

    /*
     * The paste options button's choices while the last paste can still be
     * switched (it is the last step and the cursor is still at its end), else
     * null. { current, options: [{ mode, label }] }.
     */
    App.text.pasteOptions = function pasteOptions() {
        if (!editing || !lastPaste || lastPaste.id !== editing.id || App.history.isPending() ||
            App.history.stateId() !== lastPaste.state || !lastPaste.clipboard.html || !lastPaste.clipboard.text) {
            return null;
        }
        const caret = App.text.getCaret(editing.element);
        if (!caret || JSON.stringify(caret) !== JSON.stringify(lastPaste.end)) {
            return null;
        }
        const fromEditor = lastPaste.clipboard.html.indexOf('data-deck-editor="text"') !== -1;
        return {
            current: lastPaste.mode,
            options: [{ mode: 'normal', label: fromEditor ? 'Keep source formatting' : 'Use destination theme' },
                { mode: 'plain', label: 'Keep text only' }],
        };
    };

    /* Paste the last paste again the other way ('normal' or 'plain'): its step is undone and replaced. */
    App.text.repaste = function repaste(mode) {
        if (!App.text.pasteOptions() || mode === lastPaste.mode) {
            return;
        }
        const paste = lastPaste;
        App.history.undo();   // afterHistoryChange finds the box again and puts the cursor back
        const action = editing && App.text.pasteAction(editing.element, paste.caret, paste.clipboard, mode);
        if (action) {
            runInEditor(action);
            rememberPaste(Object.assign({}, paste, { mode: mode }));
        }
    };

    /* Ctrl+C / Ctrl+X while typing: the editor's own clipboard content (copyContent); a cut is one undo step. */
    function onCopy(event) {
        const caret = editing && App.text.getCaret(editing.element);
        const content = caret && App.text.copyContent(editing.element, caret);
        if (!content) {
            return;
        }
        event.preventDefault();
        event.clipboardData.setData('text/html', content.html);
        event.clipboardData.setData('text/plain', content.text);
        if (event.type === 'cut') {
            runInEditor(App.text.cutAction(editing.element, caret));
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
        // The browser turns Ctrl+Shift+V into a paste event too; onPaste then pastes plain text.
        plainPaste = ctrl && event.shiftKey && !event.altKey && key === 'v';
        let command = null;
        if (event.key === 'Escape') {
            command = 'exit';
        } else if (ctrl && !event.altKey && key === 'z') {
            command = event.shiftKey ? 'redo' : 'undo';
        } else if (ctrl && !event.altKey && !event.shiftKey && key === 'y') {
            command = 'redo';
        }
        if (!command && event.key === 'Tab' && !ctrl && !event.altKey && isCell(editing.element)) {
            // In a table, Tab and Shift+Tab go to the next / previous cell, as in PowerPoint.
            event.preventDefault();
            event.stopPropagation();
            moveToCell(event.shiftKey ? -1 : 1);
            return;
        }
        if (!command) {
            const action = editing.element.contains(event.target) ? App.text.keyAction(editing.element, event) : null;
            if (action) {
                event.preventDefault();
                event.stopPropagation();
                if (action.run) {
                    runInEditor(action);
                }
            }
            return;
        }
        // Ours, not the browser's: its text undo would bypass the editor's history.
        event.preventDefault();
        event.stopPropagation();
        if (command === 'exit' && painter) {
            App.text.stopPainter();   // Esc first stops the painter, then (pressed again) the typing
        } else if (command === 'exit') {
            App.text.exitEdit();
        } else {
            App.commands.run(command);
        }
    }

    /*
     * Tab (step 1) / Shift+Tab (-1) in a table cell: edit the next / previous cell
     * with all its text selected. Tab in the last cell adds a row (one undo step)
     * and goes to its first cell.
     */
    function moveToCell(step) {
        const cell = editing.element;
        const next = App.tables.nextCell(cell, step);
        if (next) {
            App.text.enterEdit(next, { caret: 'all' });
            return;
        }
        if (step < 0) {
            return;
        }
        const box = boxOf(cell);
        const slideId = editing.slideId;
        App.text.exitEdit({ select: false });
        let row = null;
        App.history.change('Insert row', { slideId: slideId }, () => {
            row = App.tables.appendRow(box.querySelector(':scope > table'));
            App.tables.fitTable(box);
        });
        App.selection.select(box);
        App.text.enterEdit(row.cells[0], { caret: 'start' });
    }

    /*
     * Run a text action (a bullet key, AutoFormat, a toolbar command) as one undo
     * step that remembers the cursor before and after it.
     */
    function runInEditor(action) {
        App.text.commitTyping();
        const element = editing.element;
        const meta = { textId: editing.id, caretBefore: App.text.getCaret(element), caretAfter: null };
        applying = true;
        try {
            App.history.change(action.label, { slideId: editing.slideId }, () => App.text.runAction(element, action), { meta: meta });
        } finally {
            applying = false;
        }
        meta.caretAfter = App.text.getCaret(element);
        if (App.text.fitBox(element)) {
            App.selection.refresh();
        }
    }

    /*
     * What the list buttons work on: the selected lines of the box being
     * edited, or every line of a selected text box or shape (caret null).
     */
    function listTarget() {
        if (editing) {
            return { element: editing.element, caret: App.text.getCaret(editing.element) || END_OF_TEXT };
        }
        const text = App.text.textOf(App.selection.getElement());
        return text ? { element: text, caret: null } : null;
    }

    /* Run a list button (see listAction) on the selected lines or the selected box, as one undo step. */
    function runList(command) {
        const target = listTarget();
        const action = target && App.text.listAction(target.element, command, target.caret);
        if (!action) {
            return;
        }
        if (editing) {
            runInEditor(action);
            return;
        }
        runOnBox(target.element, action);
    }

    /* Bullets ('bullet') or Numbering ('number') on or off (SPEC 3.7 toggleList). */
    App.text.toggleList = function toggleList(list) {
        runList(list);
    };

    /* Increase (delta 1) or decrease (-1) the level (SPEC 3.7 setLevel). */
    App.text.setLevel = function setLevel(delta) {
        runList(delta > 0 ? 'indent' : 'outdent');
    };

    /* Restart ('restart') or continue ('continue') the numbering at the first selected numbered line. */
    App.text.setNumbering = function setNumbering(mode) {
        runList(mode);
    };

    /*
     * Character formatting (SPEC 3.7 applyStyle) on the selected text, the word
     * around the cursor, or all the text of a selected box. With the cursor
     * anywhere else, it is kept for the text typed next at that spot.
     */
    App.text.applyStyle = function applyStyle(style, value) {
        const target = listTarget();
        if (!target) {
            return;
        }
        const action = App.text.styleAction(target.element, style, value, target.caret);
        if (action) {
            pending = null;
            if (editing) {
                runInEditor(action);
            } else {
                runOnBox(target.element, action);
            }
            return;
        }
        if (editing && target.caret && sameCaret(target.caret)) {
            if (!pending || comparePositions(pending.caret.focus, target.caret.focus) !== 0) {
                pending = { caret: target.caret, styles: [] };
            }
            pending.styles.push([style, value]);
            App.events.emit('text-selection-changed');
        }
    };

    /* A text action on a selected box (not being edited), as one undo step. */
    function runOnBox(element, action) {
        App.history.change(action.label, { slideId: element.closest('section.slide').getAttribute('data-slide-id') }, () => {
            App.text.runAction(element, action);
            App.text.fitBox(element);
        });
        App.selection.refresh();
    }

    /* Find: edit the match's box (it must be on the slide shown) and select the match in it. */
    App.text.selectMatch = function selectMatch(element, match) {
        if (!editing || editing.element !== element) {
            App.selection.select(boxOf(element));
            App.text.enterEdit(element);
        }
        App.text.setCaret(element, { anchor: { p: match.p, o: match.start }, focus: { p: match.p, o: match.end } });
    };

    /* Replace: matches of one box as one undo step; in the box being edited the cursor ends after the replacement. */
    App.text.replaceText = function replaceText(element, matches, replacement) {
        const action = App.text.replaceAction(element, matches, replacement);
        if (!action) {
            return;
        }
        if (editing && editing.element === element) {
            runInEditor(action);
        } else {
            runOnBox(element, { label: action.label, run: () => { action.run(); return null; } });
        }
    };

    /*
     * Alignment, line spacing or space before / after (paragraphAction) on the
     * selected lines, the cursor's line, or every line of a selected box.
     */
    App.text.applyParagraph = function applyParagraph(property, value) {
        const target = listTarget();
        const action = target && App.text.paragraphAction(target.element, property, value, target.caret);
        if (!action) {
            return;
        }
        if (editing) {
            runInEditor(action);
        } else {
            runOnBox(target.element, action);
        }
    };

    /* The selected lines' paragraph look for the ribbon (see paragraphState), or {} without a text box. */
    App.text.currentParagraphState = function currentParagraphState() {
        const target = listTarget();
        return target ? App.text.paragraphState(target.element, target.caret) : {};
    };

    /*
     * The format painter: startPainter picks up the look of the text at the
     * cursor (or of the selected box); then a mouse selection, a click inside a
     * word, or a click on another text box gets it, on any slide (as in
     * PowerPoint). locked (double-click on the button): it stays on until Esc
     * or the button again.
     */
    App.text.startPainter = function startPainter(locked) {
        const target = listTarget();
        const look = target && App.text.pickLook(target.element, target.caret);
        if (!look) {
            return;
        }
        painter = { look: look, locked: !!locked };
        showPainterCursor(true);
        App.ui.setStatus('Format painter: select text, click inside a word or click a text box (Esc stops)');
        App.events.emit('painter-changed', { on: true });
    };

    App.text.stopPainter = function stopPainter() {
        if (!painter) {
            return;
        }
        painter = null;
        showPainterCursor(false);
        App.ui.setStatus('');
        App.events.emit('painter-changed', { on: false });
    };

    App.text.isPainting = function isPainting() {
        return painter !== null;
    };

    /* With the painter on, a click on a text box paints all of it (one undo step). Returns false for anything else. */
    App.text.paintBox = function paintBox(element) {
        if (!painter || !element || element.getAttribute('data-type') !== 'text') {
            return false;
        }
        const action = App.text.lookAction(element, null, painter.look);
        if (action) {
            runOnBox(element, action);
        }
        App.selection.select(element);
        if (painter && !painter.locked) {
            App.text.stopPainter();
        }
        return true;
    };

    /* The paint-brush cursor over the slide (the overlay) and inside the deck (a rule removed on save, see serialize.js). */
    function showPainterCursor(on) {
        overlayElement().classList.toggle('painting', on);
        const doc = App.deck.getDocument();
        const rule = doc && doc.head.querySelector('style[data-editor-only="painter"]');
        if (on && doc && !rule) {
            const style = doc.createElement('style');
            style.setAttribute('data-editor-only', 'painter');
            style.textContent = '* { cursor: copy !important; }';
            doc.head.appendChild(style);
        } else if (!on && rule) {
            rule.remove();
        }
    }

    /* Put the focus back into the text being edited (after the size box had it), keeping the selection. */
    App.text.refocus = function refocus() {
        if (!editing) {
            return;
        }
        const caret = App.text.getCaret(editing.element);
        editing.element.focus({ preventScroll: true });
        if (caret) {
            App.text.setCaret(editing.element, caret);
        }
    };

    /* Whether a formatting command can act now: a text box is being edited or is selected. */
    App.text.canStyle = function canStyle() {
        return listTarget() !== null;
    };

    /* What the ribbon shows as on: the selection's formatting, with what was chosen for the text typed next. */
    App.text.currentStyleState = function currentStyleState() {
        const target = listTarget();
        if (!target) {
            return {};
        }
        const state = App.text.styleState(target.element, target.caret);
        if (pending && editing && target.caret && comparePositions(pending.caret.focus, target.caret.focus) === 0) {
            pending.styles.forEach(([style, value]) => {
                if (style === 'clear') {
                    const box = shownLook(target.element);
                    Object.keys(TOGGLES).forEach((name) => { state[name] = false; });
                    state.bold = !!(box && box.b);
                    state.italic = !!(box && box.i);
                } else if (style === 'font-size') {
                    state.fontSize = parseFloat(toPoints(value));
                } else if (style === 'grow' || style === 'shrink') {
                    state.fontSize = state.fontSize ? stepSize(state.fontSize, style === 'grow' ? 1 : -1) : state.fontSize;
                } else if (style === 'font-family') {
                    state.fontFamily = value;
                } else if (TOGGLES[style]) {
                    state[style] = !state[style];
                    if (state[style] && (style === 'superscript' || style === 'subscript')) {
                        state[style === 'superscript' ? 'subscript' : 'superscript'] = false;
                    }
                }
            });
        }
        return state;
    };

    /* Whether a list button can act now (greys out the ribbon button otherwise). */
    App.text.canRunList = function canRunList(command) {
        const target = listTarget();
        return !!(target && App.text.listAction(target.element, command, target.caret));
    };

    /* { bullet, number }: whether the Bullets / Numbering buttons show "on". */
    App.text.currentListState = function currentListState() {
        const target = listTarget();
        return target ? App.text.listState(target.element, target.caret) : { bullet: false, number: false };
    };

    /*
     * A press on the slide outside the text: leave edit mode and select what is
     * there. A press in a table cell edits that cell instead; the browser then
     * puts the cursor (or starts a mouse selection) there itself.
     */
    function onDeckPointerDown(event) {
        if (!editing || editing.element.contains(event.target)) {
            return;
        }
        const cell = !painter && event.target.closest ? event.target.closest(App.tables.CELL_SELECTOR) : null;
        if (cell) {
            App.selection.select(boxOf(cell));
            App.text.enterEdit(cell, { point: { x: event.clientX, y: event.clientY } });
            return;
        }
        event.preventDefault();
        App.text.exitEdit({ select: false });
        // The deck iframe shows the slide at 1:1, so its coordinates are slide pixels.
        const element = App.selection.elementAt(event.clientX, event.clientY);
        if (painter && !App.text.paintBox(element)) {
            App.text.stopPainter();
        }
        App.selection.select(element);
    }

    /* A mouse selection (or a click inside a word) in the text being edited, with the painter on: paint it. */
    function onDeckPointerUp(event) {
        if (!painter || !editing || !editing.element.contains(event.target)) {
            return;
        }
        const caret = App.text.getCaret(editing.element);
        const action = caret && App.text.lookAction(editing.element, caret, painter.look);
        if (action) {
            runInEditor(action);
            if (painter && !painter.locked) {
                App.text.stopPainter();
            }
        }
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
        // A step that moved the cell being typed in (Insert rows above...) names it before and after: meta.cells.
        const cells = info.meta && info.meta.cells;
        const other = info.action === 'undo' ? 'redo' : 'undo';
        if (cells && cells[info.action] && cells[other] === editing.id) {
            editing.id = cells[info.action];
        }
        const found = doc && App.text.findContainer(doc, editing.slideId, editing.id);
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
        App.selection.select(boxOf(found));
    }

    /* Wiring, called once from App.start(). */
    App.text.init = function init() {
        App.events.on('history-changed', afterHistoryChange);
        // An undo of a whole-deck change may bring back a cursor rule from while the painter was on.
        App.events.on('history-changed', () => showPainterCursor(painter !== null));
        // deck.js also re-marks the same slide after undo; only a real slide change ends editing.
        App.events.on('slide-changed', () => {
            const slide = App.deck.getCurrentSlide();
            if (editing && (!slide || slide.getAttribute('data-slide-id') !== editing.slideId)) {
                App.text.exitEdit({ select: false });
            }
        });
        // A new box left empty goes once something else (or nothing) is selected.
        App.events.on('selection-changed', () => {
            if (emptyNewBox && !editing && App.selection.getElement() !== emptyNewBox.element) {
                removeEmptyNewBox();
            }
        });
        // Esc stops the painter before it does anything else (deselect, close …).
        window.addEventListener('keydown', (event) => {
            if (painter && event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                App.text.stopPainter();
            }
        }, true);
        App.events.on('deck-loaded', () => {
            painter = null;
            overlayElement().classList.remove('painting');
            editing = null;
            typing = null;
            emptyNewBox = null;
            overlayElement().classList.remove('editing');
        });
    };
})();
