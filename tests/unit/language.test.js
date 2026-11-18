/*
 * language.test.js - the deck's language (Phase 10 step 9): Review > Language
 * sets <html lang> (Portuguese or English). Edge checks spelling in the
 * languages turned on in its own settings, whatever the page says, so the
 * language matters for the PowerPoint export (PowerPoint checks each text run
 * in its language) and is explained in the editor.
 */

test('language: the deck\'s language is Portuguese unless it says English', () => {
    const lang = (value) => {
        const doc = parseDoc('<!DOCTYPE html><html' + (value === null ? '' : ' lang="' + value + '"') + '><head></head><body></body></html>');
        return App.text.deckLanguage(doc);
    };
    assertEqual([lang(null), lang('pt-BR'), lang('pt'), lang('en'), lang('en-US'), lang('en-GB'), lang('fr')],
        ['pt-BR', 'pt-BR', 'pt-BR', 'en-US', 'en-US', 'en-US', 'pt-BR']);
    const doc = parseDoc('<!DOCTYPE html><html lang="pt-BR"><head></head><body></body></html>');
    App.text.setDeckLanguage(doc, 'en-US');
    assertEqual(doc.documentElement.getAttribute('lang'), 'en-US');
    App.text.setDeckLanguage(doc, 'xx');
    assertEqual(doc.documentElement.getAttribute('lang'), 'en-US', 'only the two languages');
});

test('language: a whole-deck undo step brings the deck\'s language back', () => {
    const doc = parseDoc('<!DOCTYPE html><html lang="pt-BR"><head></head><body><section class="slide" data-slide-id="s1"></section></body></html>');
    const history = App.createHistory({ getDoc: () => doc });
    history.change('Language', 'deck', () => App.text.setDeckLanguage(doc, 'en-US'));
    history.undo();
    assertEqual(doc.documentElement.getAttribute('lang'), 'pt-BR');
    history.redo();
    assertEqual(doc.documentElement.getAttribute('lang'), 'en-US');
});

test('language: PowerPoint text runs carry the deck\'s language', () => {
    const look = { fontFamily: 'Calibri', fontSize: 24, color: 'rgb(0, 0, 0)', bold: false, italic: false, underline: false,
        strike: false, superscript: false, subscript: false, highlight: null, letterSpacing: 0, uppercase: false };
    const paragraph = { list: 'none', level: 1, number: null, marker: '', align: 'left', lineHeight: null, fontSize: 24,
        spaceBefore: 0, spaceAfter: 0, indent: 0, runs: [{ text: 'Receita', breakBefore: false, look: look }] };
    assertEqual(App.pptx.textRuns([paragraph], {}, {}, 'pt-BR')[0].options.lang, 'pt-BR');
    assertEqual(App.pptx.textRuns([paragraph], {}, {}, 'en-US')[0].options.lang, 'en-US');
    assertEqual(App.pptx.textRuns([paragraph], {})[0].options.lang, undefined, 'none given: PptxGenJS\'s own');
});
