/*
 * links.test.js - hyperlinks on text (Phase 10 step 6, Ctrl+K).
 *
 * A link is an <a href> in the text model: a web address (http / https), an
 * e-mail (mailto:) or another slide of the deck (#slide-<its data-slide-id>,
 * deck-format 5). Nothing else is ever kept (no javascript:, no file:).
 * Uses formatBox from text.test.js.
 */

test('links: what is typed in the Address box becomes a safe address, or nothing', () => {
    const address = App.text.linkAddress;
    assertEqual(address('www.example.com'), 'https://www.example.com');
    assertEqual(address('example.com/relatorio?ano=2025'), 'https://example.com/relatorio?ano=2025');
    assertEqual(address('  https://example.com  '), 'https://example.com');
    assertEqual(address('http://intranet/x'), 'http://intranet/x');
    assertEqual(address('joao.silva@example.com'), 'mailto:joao.silva@example.com');
    assertEqual(address('mailto:joao@example.com'), 'mailto:joao@example.com');
    assertEqual([address('javascript:alert(1)'), address('file:///C:/x.html'), address(''), address('nada aqui')],
        [null, null, null, null]);
});

test('links: the kind of a link, and the slide it points at', () => {
    assertEqual([App.text.linkKind('https://x.com'), App.text.linkKind('mailto:a@b.com'), App.text.linkKind('#slide-s3'),
        App.text.linkKind('javascript:x'), App.text.linkKind('#top')], ['web', 'email', 'slide', null, null]);
    assertEqual([App.text.slideLink('s3'), App.text.slideIdOf('#slide-s3'), App.text.slideIdOf('https://x.com')],
        ['#slide-s3', 's3', null]);
});

test('links: the text model keeps web, e-mail and slide links, and unwraps anything else', () => {
    const doc = parseDoc('<!DOCTYPE html><html><head></head><body><div class="el" data-type="text">' +
        '<p><a href="#slide-s2">Ir</a> <a href="javascript:alert(1)">mau</a> <a href="mailto:a@b.com">mail</a></p></div></body></html>');
    const box = doc.querySelector('.el');
    App.text.normalize(box);
    assertEqual(box.querySelector('p').innerHTML, '<a href="#slide-s2">Ir</a> mau <a href="mailto:a@b.com">mail</a>');
});

test('links: Ctrl+K on a selection links it; on a word, the word', async () => {
    const box = await formatBox(['Ver [anexo] agora']);
    App.text.runAction(box.el, App.text.linkAction(box.el, box.caret, 'https://example.com'));
    assertEqual(box.el.children[0].innerHTML, 'Ver <a href="https://example.com">anexo</a> agora');
    box.frame.remove();
    const word = await formatBox(['Ver an|exo agora']);
    const action = App.text.linkAction(word.el, word.caret, '#slide-s4');
    assertEqual(action.label, 'Link');
    App.text.runAction(word.el, action);
    assertEqual(word.el.children[0].innerHTML, 'Ver <a href="#slide-s4">anexo</a> agora');
    word.frame.remove();
});

test('links: in a link, Ctrl+K reads it and changes all of it; Remove Link takes it off all of it', async () => {
    const box = await formatBox(['Ver <a href="https://a.com">o an|exo</a> agora']);
    assertEqual(App.text.linkAt(box.el, box.caret), { href: 'https://a.com', text: 'o anexo' });
    App.text.runAction(box.el, App.text.linkAction(box.el, box.caret, 'https://b.com'));
    assertEqual(box.el.children[0].innerHTML, 'Ver <a href="https://b.com">o anexo</a> agora');
    const remove = App.text.linkAction(box.el, box.caret, null);
    assertEqual(remove.label, 'Remove link');
    App.text.runAction(box.el, remove);
    assertEqual(box.el.children[0].innerHTML, 'Ver o anexo agora');
    assertEqual(App.text.linkAt(box.el, box.caret), null);
    box.frame.remove();
});

test('links: with the cursor between words, the text to show is put in, linked', async () => {
    const box = await formatBox(['Ver | agora']);
    App.text.runAction(box.el, App.text.linkAction(box.el, box.caret, 'https://example.com', 'o site'));
    assertEqual(box.el.children[0].innerHTML, 'Ver <a href="https://example.com">o site</a> agora');
    assertEqual(App.text.getCaret(box.el), { anchor: { p: 0, o: 10 }, focus: { p: 0, o: 10 } }, 'the cursor after it');
    box.frame.remove();
});

test('links: PowerPoint gets a web link as a URL and a slide link as that slide\'s number', () => {
    const look = { fontFamily: 'Calibri', fontSize: 24, color: 'rgb(0, 0, 0)', bold: false, italic: false, underline: false,
        strike: false, superscript: false, subscript: false, highlight: null, letterSpacing: 0, uppercase: false };
    const runs = App.pptx.textRuns([{ list: 'none', level: 1, number: null, marker: '', align: 'left', lineHeight: null,
        fontSize: 24, spaceBefore: 0, spaceAfter: 0, indent: 0, runs: [
            { text: 'site', breakBefore: false, look: look, href: 'https://example.com' },
            { text: ' e ', breakBefore: false, look: look, href: null },
            { text: 'anexo', breakBefore: false, look: look, href: '#slide-s5' }] }], {}, { s5: 4 });
    assertEqual([runs[0].options.hyperlink, runs[1].options.hyperlink, runs[2].options.hyperlink],
        [{ url: 'https://example.com' }, undefined, { slide: 4 }]);
});
