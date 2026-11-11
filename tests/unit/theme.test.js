/*
 * theme.test.js - the theme editor (Phase 7): the deck's :root colours and
 * fonts, the <style data-deck-theme> that changes them, and reading another
 * deck's theme (untrusted: only colours, fonts and a data: logo come through).
 * The panel and its live preview are in e2e_test.py (test_theme_editor).
 */

test('theme: names as the panel shows them', () => {
    assertEqual(['--color-primary', '--color-accent', '--color-text', '--color-bg', '--color-accent-2', '--font-heading', '--font-body']
        .map(App.theme.labelOf), ['Primary', 'Accent', 'Text', 'Background', 'Accent 2', 'Headings', 'Body']);
});

test('theme: the colours and fonts the deck has, the standard ones first', () => {
    assertEqual(App.theme.namesOf(['--color-accent', '--color-extra', '--font-body']),
        ['--font-heading', '--font-body', '--color-primary', '--color-accent', '--color-text', '--color-bg', '--color-extra']);
});

test('theme: :root values read from stylesheet text, later rules winning, var() resolved, comments and other rules ignored', () => {
    const values = App.theme.rootValues([
        ':root { --color-primary: #CC092F; --color-accent: #1F2A44; --font-body: Calibri, Arial, sans-serif; } body { --color-text: blue; }',
        '/* :root { --color-accent: #000; } */ html, :root { --color-accent: var(--color-primary); --color-text: #222 }',
    ]);
    assertEqual(values, { '--color-primary': '#CC092F', '--color-accent': '#CC092F', '--font-body': 'Calibri, Arial, sans-serif',
        '--color-text': '#222' });
});

test('theme: only plain colours and font lists are accepted (another deck\'s values end up in our stylesheet)', () => {
    const ok = (name, value) => App.theme.safeValue(name, value);
    assertEqual([ok('--color-primary', '#CC092F'), ok('--color-primary', 'rgb(1, 2, 3)'), ok('--color-primary', 'navy'),
        ok('--font-body', '"Segoe UI", Arial, sans-serif')], [true, true, true, true]);
    assertEqual([ok('--color-primary', 'red; } body { color: red'), ok('--color-primary', 'url(http://x/y.png)'),
        ok('--font-body', 'Arial} * {'), ok('--font-body', 'x;y'), ok('--color-primary', 'var(--other)'), ok('--color-primary', '')],
        [false, false, false, false, false, false]);
});

test('theme: colours as #rrggbb for the colour picker', () => {
    assertEqual([App.theme.toHex('rgb(204, 9, 47)'), App.theme.toHex('rgba(0, 0, 0, 0.5)'), App.theme.toHex('nonsense')],
        ['#cc092f', '#000000', null]);
});

test('theme: written as one :root rule in <style data-deck-theme>, before the editor\'s own stylesheets; none when empty', () => {
    const doc = parseDoc('<html><head><style>:root { --color-primary: #CC092F; }</style><style data-deck-table></style>' +
        '<style data-deck-text></style></head><body></body></html>');
    App.theme.write(doc, { '--color-primary': '#0070C0', '--font-heading': 'Georgia, serif' });
    const style = doc.querySelector('style[data-deck-theme]');
    assertEqual(style.textContent, ':root { --color-primary: #0070C0; --font-heading: Georgia, serif; }\n');
    assertEqual(style.nextElementSibling.hasAttribute('data-deck-table'), true, 'after the deck\'s own CSS, before the editor\'s');
    assertEqual(App.theme.readOverride(doc), { '--color-primary': '#0070C0', '--font-heading': 'Georgia, serif' });
    App.theme.write(doc, {});
    assertEqual(doc.querySelector('style[data-deck-theme]'), null);
    assertEqual(App.theme.readOverride(doc), {});
});

test('theme: another deck\'s theme and master: only safe values, a logo only as a data:image', () => {
    const other = '<html><head><style>:root { --color-primary: #00843D; --color-accent: red; } body { background: url(x.png); } ' +
        ':root { --color-text: red; } } body { background: url(http://evil/x.png) ; --font-heading: Georgia, serif; }</style>' +
        '<style data-deck-master>.master-item[data-master="logo"] { background-image: url("data:image/png;base64,iVBORw0KGgo="); }</style>' +
        '</head><body><section class="slide"></section><div class="master" data-numbers="n" data-skip-title="true">' +
        '<div class="master-item" data-master="logo" data-corner="bottom-right" style="left: 1112px; top: 656px; width: 120px; height: 40px;"></div>' +
        '<div class="master-item" data-master="footer" style="left: 48px; top: 684px; width: 560px; height: 20px;">Empresa · Interno</div>' +
        '</div></body></html>';
    const theme = App.theme.fromDeckText(other);
    // --font-heading sits in a body rule after a stray brace: not the theme.
    assertEqual(theme.values, { '--color-primary': '#00843D', '--color-accent': 'red', '--color-text': 'red' });
    assertEqual([theme.master.footer, theme.master.logo.corner, theme.master.logo.src.slice(0, 15)], ['Empresa · Interno', 'bottom-right', 'data:image/png;']);
    const remote = App.theme.fromDeckText(other.replace('data:image/png;base64,iVBORw0KGgo=', 'http://evil/logo.png'));
    assertEqual(remote.master.logo, null, 'a remote logo is dropped');
    assertEqual(App.theme.fromDeckText('<html><head></head><body></body></html>'), { values: {}, master: null });
});

// ---- Into the deck's own :root (so a later hand edit in VS Code or by Copilot still works) ----

const OWN_THEME_HEAD = '<style>/* brand: :root { --color-primary: red; } */\n' +
    ':root { --font-heading: Calibri, Arial, sans-serif;\n  --color-primary: #CC092F; --color-accent: var(--color-primary); }\n' +
    'body { color: var(--color-text); }\n:root { --color-text: #222 }</style>' +
    '<style data-deck-lists>:root { --list-1-indent: 24px; }</style>';

test('theme: a value the deck declares is changed where it is declared; the rest of its CSS stays as written', () => {
    const doc = parseDoc('<html><head>' + OWN_THEME_HEAD + '<style data-deck-text></style></head><body></body></html>');
    App.theme.applyValues(doc, { '--color-primary': '#0070C0', '--color-accent': '#123456', '--color-text': '#0B0B0B' });
    assertEqual(doc.head.querySelector('style').textContent, '/* brand: :root { --color-primary: red; } */\n' +
        ':root { --font-heading: Calibri, Arial, sans-serif;\n  --color-primary: #0070C0; --color-accent: #123456; }\n' +
        'body { color: var(--color-text); }\n:root { --color-text: #0B0B0B }');
    assertEqual(doc.querySelector('style[data-deck-theme]'), null, 'no block of our own needed');
    assertEqual(doc.head.querySelector('style[data-deck-lists]').textContent, ':root { --list-1-indent: 24px; }', 'the editor\'s styles untouched');
});

test('theme: the declaration that wins (the last one) is changed; a colour the deck never declared goes in data-deck-theme', () => {
    const doc = parseDoc('<html><head><style>:root { --color-primary: #111111; }</style><style>:root { --color-primary: #222222; }</style>' +
        '<style data-deck-text></style></head><body></body></html>');
    App.theme.applyValues(doc, { '--color-primary': '#333333', '--color-extra': '#ABCDEF' });
    const own = doc.head.querySelectorAll('style:not([data-deck-theme]):not([data-deck-text])');
    assertEqual([own[0].textContent, own[1].textContent], [':root { --color-primary: #111111; }', ':root { --color-primary: #333333; }']);
    assertEqual(App.theme.readOverride(doc), { '--color-extra': '#ABCDEF' });
});

test('theme: a deck saved with a data-deck-theme block gets it folded into its own :root on open', async () => {
    const doc = parseDoc('<html><head>' + OWN_THEME_HEAD + '<style data-deck-theme>:root { --color-primary: #0070C0; --color-extra: #ABCDEF; }</style>' +
        '</head><body></body></html>');
    App.theme.fold(doc);
    assert(doc.head.querySelector('style').textContent.indexOf('--color-primary: #0070C0;') !== -1, 'moved into the deck\'s own rule');
    assertEqual(App.theme.readOverride(doc), { '--color-extra': '#ABCDEF' }, 'only what the deck never declares stays apart');
    App.theme.fold(doc);
    assertEqual(App.theme.readOverride(doc), { '--color-extra': '#ABCDEF' }, 'folding again changes nothing');
});
