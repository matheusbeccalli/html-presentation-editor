/* Tests for the Find & replace colours (src/js/findreplace.js, src/js/deck.js) */

test('find: while finding, the deck\'s selected text is painted in the current-match orange', () => {
    // The selected match is also the deck's text selection. With the keyboard in the Find panel, the browser
    // paints that selection in its grey "inactive" colour over the orange, so the deck view gives the
    // selection the same orange while the panel is open (html[data-editor-finding], set by findreplace.js).
    const css = App.deck.VIEW_CSS;
    const current = /::highlight\(editor-find-current\)\s*\{\s*background-color:\s*(#[0-9a-f]{6})/i.exec(css);
    const selection = /html\[data-editor-finding\]\s*::selection\s*\{\s*background-color:\s*(#[0-9a-f]{6})/i.exec(css);
    assert(current, 'the current-match colour is in the deck view CSS');
    assert(selection, 'a selection colour for while the Find panel is open');
    assertEqual(selection[1].toLowerCase(), current[1].toLowerCase());
});

test('find: the "finding" mark on the deck is never saved', () => {
    const doc = parseDoc('<!DOCTYPE html><html lang="pt-BR" data-editor-finding=""><head><meta charset="utf-8">' +
        '<title>Deck</title></head><body><section class="slide" data-slide-id="s1"></section></body></html>');
    const html = App.serialize.toHtml(doc, { playerJs: '', playerCss: '' });
    assertNotIncludes(html, 'data-editor-finding');
    assertIncludes(html, '<html lang="pt-BR">');
});
