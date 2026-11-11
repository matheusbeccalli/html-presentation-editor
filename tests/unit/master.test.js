/*
 * master.test.js - the slide master (Phase 7): what the fill-in dialog writes
 * into the deck's <div class="master">, and the copy of it that sync() puts on
 * every slide. The dialog itself is in e2e_test.py (test_slide_master).
 */

const LOGO_SRC = 'data:image/png;base64,iVBORw0KGgo=';

const MASTER_DECK = '<html><head><style data-deck-master></style></head><body>' +
    '<section class="slide" data-slide-id="s1" data-layout="title"><div class="el" data-type="text" data-id="e1" style="left: 0px; top: 0px; width: 10px; height: 10px; z-index: 1;"><p>A</p></div></section>' +
    '<section class="slide" data-slide-id="s2" data-layout="title-content"><aside class="notes">n</aside></section>' +
    '<section class="slide" data-slide-id="s3" data-hidden="true"></section>' +
    '</body></html>';

const ALL_SET = { logo: { src: LOGO_SRC, corner: 'bottom-left', width: 120, height: 40 },
    footer: 'Projeto Atlas', label: 'Confidencial', numbers: 'n/total', skipTitle: true };

const layerOf = (doc, id) => doc.querySelector('[data-slide-id="' + id + '"] > .master-layer');
const itemText = (doc, id, role) => {
    const layer = layerOf(doc, id);
    const item = layer && layer.querySelector('[data-master="' + role + '"]');
    return item ? item.textContent : null;
};

test('master: where each part goes on a 1280 x 720 slide', () => {
    const rects = (settings) => App.master.layout(settings).map((item) => item.role + ' ' +
        ['left', 'top', 'width', 'height'].map((name) => item.rect[name]).join(','));
    assertEqual(rects({ logo: null, footer: 'F', label: 'C', numbers: 'n', skipTitle: false }),
        ['footer 48,684,560,20', 'label 540,684,200,20', 'number 1132,684,100,20']);
    // A logo in a bottom corner pushes the footer or the number aside; none of them when nothing asks for them.
    assertEqual(rects(Object.assign({}, ALL_SET, { label: '' })), ['logo 48,656,120,40', 'footer 184,684,424,20', 'number 1132,684,100,20']);
    assertEqual(rects({ logo: { src: LOGO_SRC, corner: 'bottom-right', width: 120, height: 40 }, footer: '', label: '', numbers: 'n', skipTitle: false }),
        ['logo 1112,656,120,40', 'number 996,684,100,20']);
    assertEqual(rects({ logo: { src: LOGO_SRC, corner: 'top-right', width: 120, height: 40 }, footer: '', label: '', numbers: 'none', skipTitle: false }),
        ['logo 1112,24,120,40']);
});

test('master: a logo is 40 px high (at most 200 px wide); slide numbers as 3 or 3 / 15', () => {
    assertEqual(App.master.logoSize(300, 100), { width: 120, height: 40 });
    assertEqual(App.master.logoSize(1000, 100), { width: 200, height: 20 });
    assertEqual([App.master.numberText(2, 15, 'n'), App.master.numberText(2, 15, 'n/total')], ['3', '3 / 15']);
});

test('master: written into the deck and read back; the picture is in the stylesheet once', () => {
    const doc = parseDoc(MASTER_DECK);
    App.master.write(doc, ALL_SET);
    assertEqual(App.master.read(doc), ALL_SET);
    assertEqual(doc.documentElement.outerHTML.split(LOGO_SRC).length - 1, 1, 'the data URI is in the deck once');
    assert(doc.querySelector('style[data-deck-master]').textContent.indexOf(LOGO_SRC) !== -1, 'in the master stylesheet');
    assertEqual(doc.querySelector('.master').getAttribute('data-numbers'), 'n/total');
    // Nothing set: no master at all.
    App.master.write(doc, App.master.EMPTY);
    assertEqual([doc.querySelector('.master'), App.master.read(doc)], [null, App.master.EMPTY]);
    assertEqual(doc.documentElement.outerHTML.indexOf(LOGO_SRC), -1, 'the picture is gone too');
});

test('master: sync puts it on every slide (not the title slide), numbered as the slides stand; hidden slides count', () => {
    const doc = parseDoc(MASTER_DECK);
    App.master.write(doc, ALL_SET);
    App.master.sync(doc);
    assertEqual(layerOf(doc, 's1'), null, 'not on the title slide');
    assertEqual([itemText(doc, 's2', 'footer'), itemText(doc, 's2', 'label'), itemText(doc, 's2', 'number')],
        ['Projeto Atlas', 'Confidencial', '2 / 3']);
    assertEqual(itemText(doc, 's3', 'number'), '3 / 3', 'a hidden slide keeps its number');
    const s2 = doc.querySelector('[data-slide-id="s2"]');
    assertEqual(s2.firstElementChild.className, 'master-layer', 'first in the slide: behind its elements');
    assertEqual(s2.querySelectorAll('.master-layer .el, .master-layer [data-id]').length, 0, 'no elements, no ids: nothing to select');
    // Moved: renumbered. Title slide option off: on slide 1 too.
    doc.body.insertBefore(doc.querySelector('[data-slide-id="s3"]'), s2);
    App.master.sync(doc);
    assertEqual([itemText(doc, 's3', 'number'), itemText(doc, 's2', 'number')], ['2 / 3', '3 / 3']);
    App.master.write(doc, Object.assign({}, ALL_SET, { skipTitle: false }));
    App.master.sync(doc);
    assertEqual(itemText(doc, 's1', 'number'), '1 / 3');
    // No master: every copy goes.
    App.master.write(doc, App.master.EMPTY);
    App.master.sync(doc);
    assertEqual(doc.querySelectorAll('.master-layer').length, 0);
});

test('master: a second sync changes nothing in the deck', () => {
    const doc = parseDoc(MASTER_DECK);
    App.master.write(doc, ALL_SET);
    App.master.sync(doc);
    const observer = new MutationObserver(() => {});
    observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    App.master.sync(doc);
    const changes = observer.takeRecords();
    observer.disconnect();
    assertEqual(changes.length, 0);
});

test('import: the copies of the master on the slides are dropped (sync puts them back); the master stylesheet is there', async () => {
    const doc = parseDoc(MASTER_DECK.replace('<html>', '<html lang="pt-BR">').replace('<head>', '<head><meta charset="utf-8"><meta name="deck-format" content="3">' +
        '<style>.slide { position: relative; width: 1280px; height: 720px; overflow: hidden; } .el { position: absolute; }</style>'));
    App.master.write(doc, ALL_SET);
    App.master.sync(doc);
    const result = await App.importer.importDeck('<!DOCTYPE html>\n' + doc.documentElement.outerHTML);
    const out = parseDoc(result.html);
    assertEqual(out.querySelectorAll('.master-layer').length, 0, 'no copies');
    assert(result.report.isContract, 'still a contract deck');
    assertEqual(out.querySelectorAll('style[data-deck-master]').length, 1);
    assertEqual(App.master.read(out), ALL_SET, 'the master itself is kept');
});

// ---- A deck's own footers and numbers (they would show twice once the master has them) ----

const textBox = (id, rect, text) => '<div class="el" data-type="text" data-id="' + id + '" style="left: ' + rect[0] + 'px; top: ' + rect[1] +
    'px; width: ' + rect[2] + 'px; height: ' + rect[3] + 'px; z-index: 5;"><p>' + text + '</p></div>';
const OWN_FOOTERS_DECK = '<html><head></head><body>' +
    '<section class="slide" data-slide-id="s1" data-layout="title">' + textBox('f1', [48, 684, 400, 24], 'Projeto Atlas') + textBox('n1', [1150, 684, 80, 24], '1') + '</section>' +
    '<section class="slide" data-slide-id="s2">' + textBox('t2', [48, 40, 800, 60], 'Resumo') + textBox('f2', [48, 684, 400, 24], 'Projeto Atlas') +
        textBox('n2', [1150, 684, 80, 24], '2') + textBox('src2', [48, 650, 600, 24], 'Fonte: empresa') + '</section>' +
    '<section class="slide" data-slide-id="s3">' + textBox('f3', [48, 684, 400, 24], 'Projeto  Atlas') + textBox('n3', [1100, 684, 130, 24], 'Página 3 de 4') +
        textBox('c3', [1000, 20, 200, 24], 'CONFIDENCIAL') + '</section>' +
    '<section class="slide" data-slide-id="s4">' + textBox('f4', [48, 684, 400, 24], 'Projeto Atlas') + textBox('n4', [1150, 684, 80, 24], '4 / 4') +
        textBox('kpi4', [300, 600, 200, 100], '2') + '</section>' +
    '</body></html>';

test('master: the deck\'s own footers, slide numbers and label are found, so they do not show twice', () => {
    const doc = parseDoc(OWN_FOOTERS_DECK);
    const ids = (found) => found.map((group) => group.kind + (group.text ? ' "' + group.text + '"' : '') + ': ' +
        group.elements.map((element) => element.getAttribute('data-id')).join(','));
    const settings = { logo: null, footer: 'Projeto Atlas · Comitê', label: 'Confidencial', numbers: 'n/total', skipTitle: true };
    // Not the cover's own (the master skips the title slide), not a one-off source line, not a big "2".
    assertEqual(ids(App.master.findOwn(doc, settings)),
        ['number: n2,n3,n4', 'footer "Projeto Atlas": f2,f3,f4', 'label "CONFIDENCIAL": c3']);
    assertEqual(ids(App.master.findOwn(doc, Object.assign({}, settings, { skipTitle: false, label: '' })))[0], 'number: n1,n2,n3,n4');
    assertEqual(App.master.findOwn(doc, App.master.EMPTY), [], 'nothing asked for, nothing found');
    assertEqual(ids(App.master.findOwn(doc, Object.assign({}, App.master.EMPTY, { footer: 'F' }))), ['footer "Projeto Atlas": f2,f3,f4'],
        'only what the master is going to show');
});

const NUMBERS_ONLY = { logo: null, footer: '', label: '', numbers: 'n', skipTitle: true };
const foundIds = (doc, settings) => App.master.findOwn(doc, settings || NUMBERS_ONLY)
    .map((g) => g.elements.map((element) => element.getAttribute('data-id')).join(','));

test('master: locked boxes and parts of a group are left alone', () => {
    let doc = parseDoc(OWN_FOOTERS_DECK);
    doc.querySelector('[data-id="n2"]').setAttribute('data-locked', 'true');
    assertEqual(foundIds(doc), ['n3,n4']);
    doc = parseDoc(OWN_FOOTERS_DECK);
    const group = doc.createElement('div');
    group.className = 'el';
    group.setAttribute('data-type', 'group');
    doc.querySelector('[data-slide-id="s3"]').appendChild(group);
    group.appendChild(doc.querySelector('[data-id="n3"]'));
    assertEqual(foundIds(doc), ['n2,n4']);
});

test('master: a slide number is a pattern by an edge, one per slide: a step badge with the slide\'s number stays', () => {
    const doc = parseDoc(OWN_FOOTERS_DECK);
    const s3 = doc.querySelector('[data-slide-id="s3"]');
    s3.insertAdjacentHTML('beforeend', textBox('step3', [400, 300, 40, 40], '3') + textBox('badge3', [600, 690, 30, 24], '3'));
    assertEqual(foundIds(doc), ['n2,n3,n4'], 'not the badge mid-slide, nor the one by the edge away from the others');
    // One number on one slide is no pattern.
    const lone = parseDoc('<html><head></head><body>' +
        '<section class="slide" data-slide-id="a"><p>cover</p></section>' +
        '<section class="slide" data-slide-id="b">' + textBox('x2', [1150, 684, 80, 24], '2') + '</section>' +
        '<section class="slide" data-slide-id="c"></section><section class="slide" data-slide-id="d"></section></body></html>');
    assertEqual(foundIds(lone), []);
});

test('master: the question names the slides: slide 3, slides 2–6, slides 2, 4–5', () => {
    assertEqual([App.master.slideList([3]), App.master.slideList([2, 3, 4, 5, 6]), App.master.slideList([2, 4, 5])],
        ['slide 3', 'slides 2–6', 'slides 2, 4–5']);
    const own = App.master.findOwn(parseDoc(OWN_FOOTERS_DECK), NUMBERS_ONLY);
    assertEqual(own[0].slides, [2, 3, 4]);
});
