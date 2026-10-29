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
 * Step 1 of Phase 3 provides normalize, getModel and the stylesheet; the
 * editing half of the interface (enterEdit, exitEdit, applyStyle, setLevel,
 * toggleList) arrives with the editing steps.
 *
 * Talks to: nobody yet (pure DOM work); importer.js and the editing code will call it.
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
            '.el p[data-list] { margin: 0; }',
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
     *   { list, level, start, pStyle, wrappers, nodes }
     * nodes = the inline content (original nodes, cleaned later); wrappers =
     * formatting that surrounded the paragraph (an <i> around several blocks,
     * or a heading's bold/size/colour, or the size/colour an empty line kept).
     */
    function collectParagraphs(element) {
        const out = [];
        collectChildren(element, { para: null, listDepth: 0, wrappers: [], pStyle: {} }, out);
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
            pStyle: ctx.pStyle, wrappers: ctx.wrappers, nodes: nodes,
        };
        if (ctx.para) {
            ctx.para.start = null;   // a start number belongs to the first line only
        }
        return record;
    }

    /*
     * Wrappers that carry a block's look (a heading's size, colour, bold …) into
     * its text. On a model <p> a real font-size/color only exists on an empty
     * line; text typed into that line gets it as formatting here.
     */
    function lookWrappers(block) {
        const doc = block.ownerDocument;
        const wrappers = [];
        const styles = spanStyles(block);
        if (Object.keys(styles).length > 0) {
            const span = doc.createElement('span');
            span.setAttribute('style', styleText(styles, SPAN_ORDER));
            wrappers.push(span);
        }
        styleFormats(block).forEach((format) => wrappers.push(doc.createElement(format)));
        return wrappers;
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
        const inner = {
            para: para,
            listDepth: ctx.listDepth,
            wrappers: ctx.wrappers.concat(lookWrappers(block)),
            pStyle: Object.assign({}, ctx.pStyle, paragraphStyles(block)),
        };
        const before = out.length;
        collectChildren(block, inner, out);
        if (out.length === before) {
            // An empty block is an empty line (as the browser showed it).
            out.push(makeRecord(inner, []));
        }
    }

    function collectList(list, ctx, out) {
        const level = Math.min(ctx.listDepth + 1, MAX_LEVEL);
        const isOrdered = tagOf(list) === 'ol';
        const listType = /none/.test(list.style.getPropertyValue('list-style-type')) ? 'none'
            : isOrdered ? 'number' : 'bullet';
        let first = true;
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
                wrappers: ctx.wrappers, pStyle: ctx.pStyle };
            collectBlock(child, item, out);
        });
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
            return { '--marker-size': look.size, '--marker-color': look.color };
        }
        const look = items.length > 0 ? spanLook(items[0].parentElement, paragraph, {}) : {};
        // Spans around an empty line were dropped as empty formatting; their look is in the wrappers.
        record.wrappers.slice().reverse().forEach((wrapper) => {
            if (tagOf(wrapper) === 'span') {
                spanLook(wrapper, null, look);
            }
        });
        return { 'font-size': look.size, color: look.color };
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
        Object.assign(styles, derivedLook(p, record));
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
})();
