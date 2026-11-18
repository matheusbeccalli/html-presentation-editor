/*
 * crosstab.test.js - elements copied in one editor tab paste whole in another
 * (Phase 10 step 8). The clipboard HTML keeps the mark the editor always put
 * there (its text, for other programs), and now also the elements themselves,
 * encoded in its data-elements attribute; a paste decodes and cleans them.
 */

test('cross-tab: copied elements ride on the clipboard mark and come back cleaned', () => {
    const html = [
        '<div class="el" data-type="text" data-id="e3" style="left: 10px; top: 20px; width: 100px; height: 40px;" onclick="alert(1)"><p>Receita – São Paulo</p></div>',
        '<img class="el" data-type="image" data-id="e4" alt="" src="data:image/png;base64,AAAA" style="left: 0px; top: 0px; width: 10px; height: 10px;">',
    ];
    const data = App.elements.clipboardData(html, 'Receita – São Paulo', 'deck-editor-x1');
    assertEqual(data.text, 'Receita – São Paulo');
    const holder = parseDoc('<!DOCTYPE html><html><body>' + data.html + '</body></html>').querySelector('[data-deck-editor="element"]');
    assertEqual([holder.getAttribute('data-copy'), holder.textContent], ['deck-editor-x1', 'Receita – São Paulo'],
        'the mark and the text, as before');
    const back = App.elements.elementsFromClipboard(data.html);
    assertEqual(back.length, 2);
    const first = parseDoc('<!DOCTYPE html><html><body>' + back[0] + '</body></html>').querySelector('.el');
    assertEqual([first.textContent, first.hasAttribute('onclick'), first.getAttribute('data-id')], ['Receita – São Paulo', false, 'e3'],
        'accents kept, the handler gone (new ids come when pasted)');
    assertEqual(App.elements.elementsFromClipboard('<p>texto</p>'), null, 'nothing of ours: null');
    assertEqual(App.elements.elementsFromClipboard('<div data-deck-editor="element" data-copy="x">t</div>'), null, 'a mark without elements');
});
