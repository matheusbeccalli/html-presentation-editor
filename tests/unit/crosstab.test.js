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

test('cross-tab: elements from another deck lose links to its slides; pictures from the internet are blocked', () => {
    const html = ['<div class="el" data-type="text" data-id="e3" style="left: 0px; top: 0px; width: 10px; height: 10px;"><p><a href="#slide-s4">anexo</a> <a href="https://example.com">site</a></p></div>',
        '<img class="el" data-type="image" data-id="e4" alt="" src="https://example.com/logo.png" style="left: 0px; top: 0px; width: 10px; height: 10px;">'];
    const data = App.elements.clipboardData(html, 'anexo site', 'm', 'deck-a');
    const foreign = App.elements.elementsFromClipboard(data.html, 'deck-b');
    assert(foreign[0].indexOf('#slide-s4') === -1 && foreign[0].indexOf('https://example.com') !== -1, foreign[0]);
    assert(foreign[1].indexOf('https://example.com/logo.png') === -1, 'blocked: ' + foreign[1]);
    assert(App.elements.elementsFromClipboard(data.html, 'deck-a')[0].indexOf('#slide-s4') !== -1, 'the same deck keeps it');
});

