/*
 * background.test.js - a slide's own background colour (background.js): read
 * and written inline on its <section class="slide">. What needs the browser's
 * computed styles (Reset to Theme, Apply to All, imported decks) is in
 * e2e_test.py (test_slide_background_imported_deck, test_slide_background).
 */

test('background: a slide with no inline background follows the theme', () => {
    const doc = parseDoc('<section class="slide" style="left: 0px"></section>');
    assertEqual(App.background.ownColor(doc.querySelector('section')), null);
});

test('background: an own colour is written inline and replaces an imported gradient', () => {
    const doc = parseDoc('<section class="slide" style="background-image: linear-gradient(red, blue); background-size: cover; ' +
        'background-position: center; background-repeat: no-repeat"></section>');
    const slide = doc.querySelector('section');
    App.background.writeOwn(slide, 'var(--color-accent)');
    assertEqual(App.background.ownColor(slide), 'var(--color-accent)');
    assertEqual(slide.style.backgroundImage, 'none');
    assertEqual([slide.style.backgroundSize, slide.style.backgroundPosition, slide.style.backgroundRepeat], ['', '', '']);
});

test('background: inline var(--color-bg) counts as following the theme', () => {
    const doc = parseDoc('<section class="slide" style="background-color: var( --color-bg )"></section>');
    assertEqual(App.background.ownColor(doc.querySelector('section')), null);
});

test('background: clearOwn removes every background property and nothing else', () => {
    const doc = parseDoc('<section class="slide" style="background: red; color: blue"></section>');
    const slide = doc.querySelector('section');
    App.background.clearOwn(slide);
    assertEqual(slide.getAttribute('style').trim(), 'color: blue;');
});

test('background: a typed colour reads back as the browser stores it (rgb)', () => {
    const doc = parseDoc('<section class="slide"></section>');
    const slide = doc.querySelector('section');
    App.background.writeOwn(slide, '#00843D');
    assertEqual(App.background.ownColor(slide), 'rgb(0, 132, 61)');
});
