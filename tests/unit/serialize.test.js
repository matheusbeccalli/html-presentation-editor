/* Tests for src/js/serialize.js (clean saved output, SPEC 3.6) */

const PLAYER = { playerJs: '(function(){ /* player */ })();', playerCss: '.slide{}' };

function editedDeck() {
    return parseDoc(
        '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Deck</title>' +
        '<style data-editor-only>.slide{display:none}</style><style>.el{position:absolute}</style></head><body>' +
        '<section class="slide editor-current" data-slide-id="s1" data-editor-current="true">' +
        '<div class="el editor-selected" data-type="text" data-id="e1" contenteditable="true" spellcheck="true" data-editor-temp="7" style="left:1px">Olá</div>' +
        '</section><div data-editor-only class="overlay"></div></body></html>'
    );
}

test('serialize: strips editor-only elements, attributes and classes', () => {
    const html = App.serialize.toHtml(editedDeck(), PLAYER);
    assertNotIncludes(html, 'data-editor');
    assertNotIncludes(html, 'editor-current');
    assertNotIncludes(html, 'editor-selected');
    assertNotIncludes(html, 'contenteditable');
    assertNotIncludes(html, 'spellcheck');
    assertNotIncludes(html, 'overlay');
    // Text is also normalized into the text model on save (SPEC Phase 3).
    assertIncludes(html, '<div class="el" data-type="text" data-id="e1" style="left:1px"><p data-list="none" data-level="1">Olá</p></div>');
});

test('serialize: does not modify the live document', () => {
    const doc = editedDeck();
    App.serialize.toHtml(doc, PLAYER);
    assert(doc.querySelector('[data-editor-only]'), 'editor style still in the live deck');
    assert(doc.querySelector('[contenteditable]'), 'contenteditable still in the live deck');
});

test('serialize: starts with a doctype and declares charset and deck-format', () => {
    const html = App.serialize.toHtml(parseDoc('<html><head></head><body></body></html>'), PLAYER);
    assert(html.startsWith('<!DOCTYPE html>'), 'doctype first');
    const doc = parseDoc(html);
    assertEqual(doc.querySelectorAll('meta[name="deck-format"]').length, 1);
    assertEqual(doc.querySelector('meta[name="deck-format"]').getAttribute('content'), '3');
    assert(doc.head.firstElementChild.matches('meta[charset]'), 'charset is the first element of <head>');
});

test('serialize: injects the player script and style exactly once', () => {
    const once = App.serialize.toHtml(editedDeck(), PLAYER);
    const twice = App.serialize.toHtml(parseDoc(once), PLAYER);
    const doc = parseDoc(twice);
    assertEqual(doc.querySelectorAll('script[data-deck-player]').length, 1);
    assertEqual(doc.querySelectorAll('style[data-deck-player]').length, 1);
    assertIncludes(doc.querySelector('script[data-deck-player]').textContent, '/* player */');
});

test('serialize: saving twice gives the same file (stable round trip)', () => {
    const once = App.serialize.toHtml(editedDeck(), PLAYER);
    const twice = App.serialize.toHtml(parseDoc(once), PLAYER);
    assertEqual(twice, once);
});

test('serialize: keeps the deck language, notes, hidden slides and chart JSON', () => {
    const doc = parseDoc(
        '<html lang="pt-BR"><body><section class="slide" data-slide-id="s1" data-hidden="true">' +
        '<figure class="el" data-type="chart"><script type="application/json" class="chart-data">{"a":1}</script><svg></svg></figure>' +
        '<aside class="notes">Notas</aside></section></body></html>'
    );
    const out = parseDoc(App.serialize.toHtml(doc, PLAYER));
    assertEqual(out.documentElement.getAttribute('lang'), 'pt-BR');
    assertEqual(out.querySelector('.slide').getAttribute('data-hidden'), 'true');
    assertEqual(out.querySelector('aside.notes').textContent, 'Notas');
    assertEqual(out.querySelector('script.chart-data').textContent, '{"a":1}');
});

test('serialize: removes the class attribute when only editor classes were on it', () => {
    const doc = parseDoc('<body><div class="editor-selected" data-id="x">a</div></body>');
    const html = App.serialize.toHtml(doc, PLAYER);
    assertIncludes(html, '<div data-id="x">a</div>');
});

test('serialize: a clean copy for sending leaves out hidden slides (when asked) and the deck id', () => {
    const deck = () => parseDoc(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="deck-id" content="d-123"><title>Deck</title></head><body>' +
        '<section class="slide" data-slide-id="s1"></section>' +
        '<section class="slide" data-slide-id="s2" data-hidden="true"></section>' +
        '<section class="slide" data-slide-id="s3"></section></body></html>');
    const ids = (html) => Array.from(parseDoc(html).querySelectorAll('section.slide')).map((s) => s.getAttribute('data-slide-id'));
    const doc = deck();
    const clean = App.serialize.toHtml(doc, PLAYER, { cleanCopy: true, removeHidden: true });
    assertEqual(ids(clean), ['s1', 's3']);
    assertNotIncludes(clean, 'deck-id');
    assertEqual(ids(App.serialize.toHtml(deck(), PLAYER, { cleanCopy: true, removeHidden: false })), ['s1', 's2', 's3']);
    assertIncludes(App.serialize.toHtml(deck(), PLAYER), 'name="deck-id"');
    assertEqual(doc.querySelectorAll('section.slide').length, 3, 'the deck itself keeps every slide');
});
