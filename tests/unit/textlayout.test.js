/*
 * textlayout.test.js - text box layout and Change Case (Phase 10 step 2).
 *
 * Align Text (top / middle / bottom) is the box's own inline flex column, the
 * form the importer already writes for a vertically centred title; a shape's
 * text area always is one. Inner margins are the box's padding. Change Case
 * changes the letters themselves, one character for one, so the formatting
 * around them stays where it was. Uses formatBox from text.test.js.
 */

test('change case: each kind, with the text around the range deciding where words and sentences start', () => {
    const change = App.text.changeCase;
    const all = (text, kind) => change(text, 0, text.length, kind);
    assertEqual(all('Receita líquida', 'upper'), 'RECEITA LÍQUIDA');
    assertEqual(all('RECEITA Líquida', 'lower'), 'receita líquida');
    assertEqual(all("ana PAULA d'ávila-silva", 'title'), "Ana Paula D'ávila-Silva");
    assertEqual(all('ola MUNDO. tudo bem? sim! ok', 'sentence'), 'Ola mundo. Tudo bem? Sim! Ok');
    assertEqual(all('Receita EBITDA', 'toggle'), 'rECEITA ebitda');
    assertEqual(change('receita LIQUIDA total', 8, 15, 'title'), 'receita Liquida total', 'only the range changes');
    assertEqual(change('margem. ebitda', 8, 14, 'sentence'), 'margem. Ebitda', 'a sentence starts after ". "');
    assertEqual(change('a\nb', 0, 3, 'upper'), 'A\nB', 'a line break (counted as one) stays');
    assertEqual(all('straße', 'upper'), 'STRAßE', 'a letter that would become two stays as it is');
});

test('change case: Shift+F3 goes lowercase -> UPPERCASE -> Capitalize Each Word -> lowercase', () => {
    const next = App.text.nextCase;
    assertEqual([next('receita'), next('RECEITA'), next('Receita Líquida'), next('reCEITA'), next('2024')],
        ['upper', 'title', 'lower', 'lower', 'upper']);
});

test('change case: on the selection, the letters change and the formatting stays', async () => {
    const box = await formatBox(['receita [<b>líquida</b> total]']);
    App.text.runAction(box.el, App.text.caseAction(box.el, 'upper', box.caret));
    assertEqual(box.el.children[0].innerHTML, 'receita <b>LÍQUIDA</b> TOTAL');
    assertEqual(App.text.getCaret(box.el), { anchor: { p: 0, o: 8 }, focus: { p: 0, o: 21 } }, 'the selection stays');
    box.frame.remove();
});

test('change case: a cursor in a word changes the word; a selected box (no cursor) all its lines', async () => {
    const word = await formatBox(['receita lí|quida total']);
    const action = App.text.caseAction(word.el, 'cycle', word.caret);
    assertEqual(action.label, 'Change case');
    App.text.runAction(word.el, action);
    assertEqual(word.el.children[0].innerHTML, 'receita LÍQUIDA total');
    word.frame.remove();
    const box = await formatBox(['RECEITA|', 'MARGEM <i>EBITDA</i>']);   // the cursor is not used: caret null
    App.text.runAction(box.el, App.text.caseAction(box.el, 'title', null));
    assertEqual(Array.from(box.el.children, (p) => p.innerHTML), ['Receita', 'Margem <i>Ebitda</i>']);
    assertEqual(App.text.caseAction(box.el, 'title', null), null, 'nothing to change: no undo step');
    box.frame.remove();
});

test('align text: a text box is top, middle or bottom by its own flex column; top leaves no trace', () => {
    const doc = parseDoc('<!DOCTYPE html><html><head></head><body><section class="slide">' +
        '<div class="el" data-type="text" data-id="e1" style="left: 0px; top: 0px; width: 200px; height: 100px;"><p>A</p></div>' +
        '</section></body></html>');
    const box = doc.querySelector('.el');
    assertEqual(App.text.anchorOf(box), 'top');
    App.text.setAnchor(box, 'middle');
    assertEqual([box.style.display, box.style.flexDirection, box.style.justifyContent], ['flex', 'column', 'center']);
    assertEqual(App.text.anchorOf(box), 'middle');
    App.text.setAnchor(box, 'bottom');
    assertEqual([box.style.justifyContent, App.text.anchorOf(box)], ['flex-end', 'bottom']);
    App.text.setAnchor(box, 'top');
    assertEqual([box.style.display, box.style.justifyContent, App.text.anchorOf(box)], ['', '', 'top']);
    // A title the importer centred (keepVerticalAlignment) reads as middle.
    box.setAttribute('style', box.getAttribute('style') + ' display: flex; flex-direction: column; justify-content: center; align-items: stretch;');
    assertEqual(App.text.anchorOf(box), 'middle');
});

test('align text: a shape\'s text area (middle when new) and inner margins of both', () => {
    const doc = parseDoc('<!DOCTYPE html><html><head></head><body><section class="slide">' +
        '<div class="el" data-type="text" data-id="e1" style="left: 0px; top: 0px; width: 200px; height: 100px;"><p>A</p></div>' +
        '</section></body></html>');
    const shape = App.shapes.createShape(doc, 'rect', { left: 0, top: 0, width: 200, height: 100 }, 'e2');
    assertEqual(App.text.anchorOf(shape), 'middle');
    App.text.setAnchor(shape, 'bottom');
    assertEqual(shape.querySelector('.shape-text').style.justifyContent, 'flex-end');
    assertEqual(App.text.anchorOf(shape), 'bottom');
    App.text.setAnchor(shape, 'top');
    assertEqual([shape.querySelector('.shape-text').style.display, App.text.anchorOf(shape)], ['flex', 'top'], 'a shape stays a column');
    // Margins: the padding of the box (of a shape's text area).
    assertEqual(App.text.marginsOf(shape), { left: 10, right: 10, top: 5, bottom: 5 }, 'a new shape: 5 px 10 px');
    App.text.setMargins(shape, { left: 4, right: 4, top: 2, bottom: 2 });
    assertEqual(App.text.marginsOf(shape), { left: 4, right: 4, top: 2, bottom: 2 });
    const box = doc.querySelector('[data-id="e1"]');
    App.text.setMargins(box, { left: 9.6, right: 9.6, top: 4.8, bottom: 4.8 });
    assertEqual([box.style.paddingLeft, box.style.paddingTop], ['9.6px', '4.8px']);
    assertEqual(App.text.marginsOf(box), { left: 9.6, right: 9.6, top: 4.8, bottom: 4.8 });
    assertEqual(App.text.canLayout(box) && App.text.canLayout(shape), true);
    const line = App.shapes.createShape(doc, 'line', { left: 0, top: 0, width: 200, height: 0 }, 'e3');
    assertEqual(App.text.canLayout(line), false, 'a line holds no text');
});
