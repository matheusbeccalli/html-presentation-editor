/*
 * slides.test.js - new slides from the built-in layouts, duplicated slides
 * (Phase 7). The live actions (add, duplicate, delete, undo) are in e2e_test.py.
 */

function slidesDeck(slidesHtml) {
    return parseDoc('<html><head></head><body>' + slidesHtml + '</body></html>');
}

const TITLE_SLIDE = '<section class="slide" data-slide-id="s1" data-layout="title">' +
    '<img class="el" data-type="image" data-id="e1" style="left:64px; top:56px; width:120px; height:40px; z-index:1">' +
    '<div class="el" data-type="text" data-id="e2" style="left: 90px; top: 230px; width: 1000px; height: 120px; z-index: 2; ' +
    'font-family: var(--font-heading); font-size: 39pt; color: var(--color-accent); font-weight: bold;">' +
    '<p data-list="none" data-level="1">Projeto Atlas</p></div>' +
    '<div class="el" data-type="text" data-id="e4" style="left: 90px; top: 378px; width: 1000px; height: 70px; z-index: 4; font-size: 16.5pt;">' +
    '<p data-list="none" data-level="1">Comitê</p></div>' +
    '<aside class="notes">Abrir.</aside></section>';

const CONTENT_SLIDE = '<section class="slide" data-slide-id="s2" data-layout="title-content">' +
    '<div class="el" data-type="text" data-id="e5" style="left: 80px; top: 40px; width: 1100px; height: 70px; z-index: 1; ' +
    'font-family: var(--font-heading); font-size: 28pt; color: rgb(204, 9, 47); font-weight: bold;">' +
    '<p data-list="none" data-level="1">Sumário executivo</p></div>' +
    '<div class="el" data-type="text" data-id="e7" style="left: 80px; top: 150px; width: 1100px; height: 480px; z-index: 3; font-size: 16.5pt;">' +
    '<p data-list="bullet" data-level="1">Receita</p></div>' +
    '<aside class="notes">Reforçar.</aside></section>';

function rectOf(element) {
    return ['left', 'top', 'width', 'height'].map((name) => parseFloat(element.style[name]));
}

test('slides: a fresh slide id is one no slide has', () => {
    const doc = slidesDeck('<section class="slide" data-slide-id="s1"></section><section class="slide" data-slide-id="s2"></section>' +
        '<section class="slide" data-slide-id="s5"></section>');
    assertEqual(App.slides.freshSlideId(doc), 's3');
});

test('slides: the title of a slide is its largest text in the upper part', () => {
    const doc = slidesDeck(TITLE_SLIDE + CONTENT_SLIDE);
    assertEqual(App.slides.titleOf(doc.querySelector('[data-slide-id="s1"]')).getAttribute('data-id'), 'e2');
    assertEqual(App.slides.titleOf(doc.querySelector('[data-slide-id="s2"]')).getAttribute('data-id'), 'e5');
    const low = slidesDeck('<section class="slide" data-slide-id="s1"><div class="el" data-type="text" data-id="e1" ' +
        'style="left:0; top:500px; width:100px; height:40px; font-size:40pt"><p>Rodapé</p></div></section>');
    assertEqual(App.slides.titleOf(low.querySelector('section')), null, 'nothing in the upper part');
});

test('slides: a new Title and Content slide takes its title from the deck\'s content slides', () => {
    const doc = slidesDeck(TITLE_SLIDE + CONTENT_SLIDE);
    const slide = App.slides.buildSlide(doc, 'title-content', 's9');
    assertEqual(slide.getAttribute('data-slide-id'), 's9');
    assertEqual(slide.getAttribute('data-layout'), 'title-content');
    assertEqual(slide.className, 'slide');
    const [title, body] = slide.querySelectorAll(':scope > .el[data-type="text"]');
    assertEqual(rectOf(title).join(','), '80,40,1100,70', 'where the deck\'s titles are');
    assertEqual(title.style.fontSize, '28pt');
    assertEqual(title.style.color, 'rgb(204, 9, 47)');
    assertEqual(title.textContent, 'Título do slide');
    const [left, top, width, height] = rectOf(body);
    assertEqual(left + ',' + width, '80,1100', 'body under the title, as wide');
    assert(top >= 110 && top + height <= 720, 'body below the title, inside the slide: ' + top + ' ' + height);
    assertEqual(body.querySelector('p').getAttribute('data-list'), 'bullet', 'a bulleted body');
    assertEqual(slide.lastElementChild.outerHTML, '<aside class="notes"></aside>', 'empty notes, last');
});

test('slides: a new Title Slide takes its title from the deck\'s title slide', () => {
    const doc = slidesDeck(TITLE_SLIDE + CONTENT_SLIDE);
    const slide = App.slides.buildSlide(doc, 'title', 's9');
    const [title, subtitle] = slide.querySelectorAll(':scope > .el[data-type="text"]');
    assertEqual(rectOf(title).join(','), '90,230,1000,120');
    assertEqual(title.style.fontSize, '39pt');
    assertEqual(title.textContent, 'Título da apresentação');
    assert(parseFloat(subtitle.style.top) >= 350, 'subtitle under the title');
});

test('slides: Two Content splits the body in two columns under the title', () => {
    const doc = slidesDeck(TITLE_SLIDE + CONTENT_SLIDE);
    const slide = App.slides.buildSlide(doc, 'two-columns', 's9');
    const boxes = slide.querySelectorAll(':scope > .el[data-type="text"]');
    assertEqual(boxes.length, 3);
    const [, a, b] = Array.from(boxes, rectOf);
    assertEqual(a[0], 80, 'left column starts with the title');
    assertEqual(b[0] + b[2], 1180, 'right column ends with the title');
    assert(a[0] + a[2] < b[0], 'a gap between the columns');
    assertEqual(a[1], b[1], 'same top');
});

test('slides: a deck without such slides gets the built-in title; Blank has no boxes', () => {
    const doc = slidesDeck('<section class="slide" data-slide-id="s1"></section>');
    const title = App.slides.buildSlide(doc, 'title-content', 's9').querySelector('.el');
    assertEqual(rectOf(title).join(','), '64,48,1152,60');
    assertEqual(title.style.fontFamily, 'var(--font-heading)');
    const blank = App.slides.buildSlide(doc, 'blank', 's10');
    assertEqual(blank.querySelectorAll('.el').length, 0);
    assertEqual(blank.getAttribute('data-layout'), 'blank');
});

test('slides: new boxes get element ids no other element has', () => {
    const doc = slidesDeck(TITLE_SLIDE + CONTENT_SLIDE);
    const slide = App.slides.buildSlide(doc, 'two-columns', 's9');
    const used = new Set(Array.from(doc.querySelectorAll('[data-id]'), (node) => node.getAttribute('data-id')));
    const ids = Array.from(slide.querySelectorAll('[data-id]'), (node) => node.getAttribute('data-id'));
    assertEqual(new Set(ids).size, 3, 'all different');
    assert(ids.every((id) => !used.has(id)), 'none taken: ' + ids);
});

test('slides: a copy of a slide has a new slide id and new element ids, the same content and notes', () => {
    const doc = slidesDeck(TITLE_SLIDE + CONTENT_SLIDE);
    const original = doc.querySelector('[data-slide-id="s2"]');
    original.setAttribute('data-editor-current', '');
    original.setAttribute('data-hidden', 'true');
    const copy = App.slides.copyOf(original, 's3');
    assertEqual(copy.getAttribute('data-slide-id'), 's3');
    assert(!copy.hasAttribute('data-editor-current'), 'not marked as the slide shown');
    assertEqual(copy.getAttribute('data-hidden'), 'true', 'a hidden slide\'s copy is hidden too');
    const ids = Array.from(copy.querySelectorAll('[data-id]'), (node) => node.getAttribute('data-id'));
    assertEqual(ids.length, 2);
    assert(ids.every((id) => !doc.querySelector('[data-id="' + id + '"]')), 'fresh ids: ' + ids);
    assertEqual(copy.textContent, original.textContent);
    assertEqual(copy.querySelector('aside.notes').textContent, 'Reforçar.');
    assert(original.hasAttribute('data-editor-current'), 'the original is untouched');
});

test('slides: the layout a new slide gets by default follows the slide shown', () => {
    const doc = slidesDeck(TITLE_SLIDE + CONTENT_SLIDE + '<section class="slide" data-slide-id="s3" data-layout="two-columns"></section>' +
        '<section class="slide" data-slide-id="s4"></section>');
    const layout = (id) => App.slides.nextLayout(doc.querySelector('[data-slide-id="' + id + '"]'));
    assertEqual(layout('s1'), 'title-content', 'after a title slide: content');
    assertEqual(layout('s2'), 'title-content');
    assertEqual(layout('s3'), 'two-columns');
    assertEqual(layout('s4'), 'title-content', 'no layout said');
    assertEqual(App.slides.nextLayout(null), 'title-content');
});
