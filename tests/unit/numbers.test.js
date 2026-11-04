/*
 * numbers.test.js - numbers as text (Phase 4 tables, later chart labels): reading
 * "1.234,5" or "1,234.5", and writing them back with other separators, decimals,
 * percent or parentheses.
 */

function readNumber(text, locale) {
    return App.numbers.parse(text, locale || 'pt-BR');
}

/* parse `text`, change it, and write it in `locale` (pt-BR by default). */
function rewritten(text, change, locale) {
    const number = readNumber(text, locale);
    return App.numbers.format(change ? change(number) : number, locale || 'pt-BR');
}

test('numbers: reads the separators of pt-BR and en-US', () => {
    const pt = readNumber('1.234,5');
    assertEqual([pt.int, pt.frac, pt.grouped, pt.negative], ['1234', '5', true, false]);
    const both = readNumber('1,234.5', 'pt-BR');
    assertEqual([both.int, both.frac, both.grouped], ['1234', '5', true], 'both separators: the last one is the decimal');
    assertEqual([readNumber('2,45', 'en-US').int, readNumber('2,45', 'en-US').frac], ['2', '45'], 'two digits after: a decimal');
    assertEqual([readNumber('1.234.567', 'en-US').int, readNumber('1.234.567', 'en-US').grouped], ['1234567', true]);
    assertEqual(readNumber('0,123', 'en-US').frac, '123', 'a leading zero: a decimal');
    assertEqual(readNumber('2450').grouped, false);
});

test('numbers: one separator before three digits is read the locale\'s way', () => {
    const pt = readNumber('2.450', 'pt-BR');
    assertEqual([pt.int, pt.frac, pt.grouped], ['2450', '', true]);
    const en = readNumber('2.450', 'en-US');
    assertEqual([en.int, en.frac, en.grouped], ['2', '450', false]);
    assertEqual(readNumber('2,450', 'en-US').int, '2450');
});

test('numbers: reads signs, parentheses, currency and units', () => {
    const multiple = readNumber('(1,2x)');
    assertEqual([multiple.negative, multiple.parens, multiple.int, multiple.frac, multiple.suffix], [true, true, '1', '2', 'x']);
    const percent = readNumber('-3,5%');
    assertEqual([percent.negative, percent.parens, percent.suffix], [true, false, '%']);
    const money = readNumber('R$ 1.234 mn');
    assertEqual([money.prefix, money.int, money.suffix], ['R$ ', '1234', ' mn']);
    assertEqual(readNumber('+12,0%').sign, '+');
    assertEqual(readNumber('−4').negative, true, 'the minus sign character');
    assertEqual(readNumber(' 9,8x ').int, '9', 'spaces around');
});

test('numbers: words, dates, codes and placeholders are not numbers', () => {
    ['Beta Foods', '2025E', '12/03/2025', '1.2.3,4,5', '(12', '12)', 'x', '%', '1,23,4', '', 'n.a.', '-', '(-1)', '--1', '1,2,3.4.5']
        .forEach((text) => assertEqual(readNumber(text), null, text));
    ['', '  ', '-', '–', '—', 'n.a.', 'n.m.', 'N/A', 'n/d', 'nm'].forEach((text) => assert(App.numbers.isBlank(text), 'blank: ' + text));
    ['abc', '12', 'x'].forEach((text) => assert(!App.numbers.isBlank(text), 'not blank: ' + text));
});

test('numbers: format writes back what it read, in the locale chosen', () => {
    ['2.450', '(1,2x)', '-3,5%', 'R$ 1.234 mn', '+12,0%', '0,5', '1.234.567,89', '9,8x', '−4']
        .forEach((text) => assertEqual(rewritten(text), text));
    assertEqual(App.numbers.format(readNumber('1.234,5'), 'en-US'), '1,234.5');
    assertEqual(App.numbers.format(readNumber('1234,5'), 'en-US'), '1234.5');
    assertEqual(rewritten('1,234.5', null, 'en-US'), '1,234.5');
});

test('numbers: thousands separator and negatives in parentheses on and off', () => {
    const grouped = (on) => (n) => Object.assign({}, n, { grouped: on });
    const parens = (on) => (n) => Object.assign({}, n, { parens: on });
    assertEqual(rewritten('1234567,5', grouped(true)), '1.234.567,5');
    assertEqual(rewritten('1.234', grouped(false)), '1234');
    assertEqual(rewritten('-3,5%', parens(true)), '(3,5%)');
    assertEqual(rewritten('(1,2x)', parens(false)), '-1,2x');
    assertEqual(rewritten('R$ -1.234', parens(true)), '(R$ 1.234)', 'the sign goes before the currency');
    assertEqual(rewritten('12', parens(true)), '12', 'only negatives get parentheses');
});

test('numbers: withDecimals rounds half up and pads with zeros', () => {
    const places = (count) => (n) => App.numbers.withDecimals(n, count);
    assertEqual(rewritten('19,25', places(1)), '19,3');
    assertEqual(rewritten('9,95', places(1)), '10,0');
    assertEqual(rewritten('999,5', places(0)), '1000');
    assertEqual(rewritten('9.999,5', places(0)), '10.000');
    assertEqual(rewritten('0,5', places(0)), '1');
    assertEqual(rewritten('2.450', places(2)), '2.450,00');
    assertEqual(rewritten('-0,04', places(1)), '0,0', 'no minus on a zero');
    assertEqual(rewritten('(1,25x)', places(1)), '(1,3x)');
});

test('numbers: percent on and off moves the decimal point, keeping every digit', () => {
    assertEqual(rewritten('0,195', App.numbers.toPercent), '19,5%');
    assertEqual(rewritten('0,2', App.numbers.toPercent), '20%');
    assertEqual(rewritten('-0,035', App.numbers.toPercent), '-3,5%');
    assertEqual(rewritten('12', App.numbers.toPercent), '1200%');
    assertEqual(rewritten('19,5%', App.numbers.fromPercent), '0,195');
    assertEqual(rewritten('20%', App.numbers.fromPercent), '0,20');
    assertEqual(rewritten('(3,5%)', App.numbers.fromPercent), '(0,035)');
});

test('numbers: the locale follows the deck language', () => {
    assertEqual(App.numbers.localeFor('pt-BR'), 'pt-BR');
    assertEqual(App.numbers.localeFor('pt'), 'pt-BR');
    assertEqual(App.numbers.localeFor('en'), 'en-US');
    assertEqual(App.numbers.localeFor('en-GB'), 'en-US');
    assertEqual(App.numbers.localeFor(''), 'pt-BR');
    assertEqual(App.numbers.localeFor(null), 'pt-BR');
});

test('numbers: localeShown tells the locale from the numbers that are clear about it', () => {
    assertEqual(App.numbers.localeShown(['9,8x', '19,5%', '2.450', 'Beta']), 'pt-BR');
    assertEqual(App.numbers.localeShown(['1.234.567', '780']), 'pt-BR', 'a separator used twice groups thousands');
    assertEqual(App.numbers.localeShown(['1,234.5', '2.450']), 'en-US');
    assertEqual(App.numbers.localeShown(['0,123']), 'pt-BR', 'a leading zero: a decimal comma');
    assertEqual(App.numbers.localeShown(['2.450', '780', 'n.a.']), null, 'nothing clear');
    assertEqual(App.numbers.localeShown(['19,5%', '1.5x']), null, 'both: nothing to go by');
});
