/*
 * numbers.js - numbers written as text (SPEC Phase 4: table cells; Phase 6
 * will reuse it for chart labels).
 *
 * A cell holds text, not a value: "2.450", "(1,2x)", "-3,5%", "R$ 1.234 mn".
 * parse() reads such a text into its parts, the format buttons change the
 * parts, and format() writes them back with the separators of a locale:
 *
 *   pt-BR  1.234,5      en-US  1,234.5
 *
 * The digits are kept as text, never as a JavaScript number, so nothing is
 * lost to rounding: 0,195 -> 19,5% -> 0,195.
 *
 * A number's parts: { sign: '' | '+' | '-' | '−', negative, parens,
 * prefix ('R$ '), int ('1234'), frac ('5'), grouped (thousands separator
 * shown), suffix ('%', 'x', ' mn') }.
 *
 * Talks to: nothing (tables.js and tabledesign.js use it).
 */

(function () {
    'use strict';

    App.numbers = {};

    App.numbers.LOCALES = Object.freeze({
        'pt-BR': Object.freeze({ group: '.', decimal: ',', sample: '1.234,5' }),
        'en-US': Object.freeze({ group: ',', decimal: '.', sample: '1,234.5' }),
    });

    // sign, currency, sign again ("R$ -1.234"), the digits, a unit; all optional but the digits.
    const NUMBER = new RegExp('^([-+−]?)((?:R\\$|US\\$|\\$|€|£)\\s?)?([-+−]?)(\\d[\\d.,]*|[.,]\\d+)' +
        '(\\s?(?:%|x|×|pp|p\\.p\\.|bps|bp|k|mn|mm|mi|bi|bn))?$', 'i');

    // Shown in finance tables where a number is missing: they do not make a column text.
    const BLANK = /^(?:|[-–—]|n\.?\s?[adm]\.?|n\/[ad])$/i;

    /* Empty, or a dash / n.a. / n.m. standing in for a number. */
    App.numbers.isBlank = function isBlank(text) {
        return BLANK.test(String(text).trim());
    };

    /* The locale numbers are written in for a deck in language `lang` ("en-…" or anything else). */
    App.numbers.localeFor = function localeFor(lang) {
        return /^en\b/i.test(lang || '') ? 'en-US' : 'pt-BR';
    };

    /*
     * Which character of `body` ("1.234,5") is its decimal separator, or ''.
     * Both kinds: the last one. One separator used twice: a thousands separator.
     * One separator once: a decimal unless exactly three digits follow it; then
     * (as in "2.450") the locale decides.
     */
    function decimalOf(body, locale) {
        const dot = body.lastIndexOf('.');
        const comma = body.lastIndexOf(',');
        if (dot !== -1 && comma !== -1) {
            return dot > comma ? '.' : ',';
        }
        const separator = dot !== -1 ? '.' : (comma !== -1 ? ',' : '');
        if (!separator || body.indexOf(separator) !== body.lastIndexOf(separator)) {
            return '';
        }
        const at = body.indexOf(separator);
        const looksGrouped = body.length - at - 1 === 3 && at >= 1 && at <= 3 && body[0] !== '0';
        if (!looksGrouped) {
            return separator;
        }
        return App.numbers.LOCALES[locale].decimal === separator ? separator : '';
    }

    /* "1.234,5" -> { int: '1234', frac: '5', grouped: true }, or null if the separators make no sense. */
    function readDigits(body, locale) {
        const decimal = decimalOf(body, locale);
        const parts = decimal ? body.split(decimal) : [body];
        if (parts.length > 2 || (decimal && parts[1] === '') || !/^\d*$/.test(parts[1] || '')) {
            return null;
        }
        const whole = parts[0] || '0';
        if (/^\d+$/.test(whole)) {
            return { int: whole, frac: parts[1] || '', grouped: false };
        }
        // Thousands separators: the one that is not the decimal, between groups of three digits.
        const group = whole.replace(/\d/g, '')[0];
        if (group === decimal || !/^\d{1,3}(?:([.,])\d{3})*$/.test(whole) || whole.split(group).some((part) => /\D/.test(part))) {
            return null;
        }
        return { int: whole.split(group).join(''), frac: parts[1] || '', grouped: true };
    }

    /* The parts of a number written as `text`, read the `locale`'s way where it is ambiguous; null when it is not one number. */
    App.numbers.parse = function parse(text, locale) {
        let rest = String(text).trim();
        const parens = /^\(.*\)$/.test(rest);
        if (parens) {
            rest = rest.slice(1, -1).trim();
        }
        const found = NUMBER.exec(rest);
        if (!found || (found[1] && found[3]) || (parens && (found[1] || found[3]))) {
            return null;
        }
        const digits = readDigits(found[4], locale || 'pt-BR');
        if (!digits) {
            return null;
        }
        const sign = found[1] || found[3];
        return {
            sign: sign, negative: parens || sign === '-' || sign === '−', parens: parens,
            prefix: found[2] || '', int: digits.int, frac: digits.frac, grouped: digits.grouped, suffix: found[5] || '',
        };
    };

    function isZero(number) {
        return !/[1-9]/.test(number.int + number.frac);
    }

    /* Write a number's parts with the separators of `locale`. */
    App.numbers.format = function format(number, locale) {
        const separators = App.numbers.LOCALES[locale] || App.numbers.LOCALES['pt-BR'];
        let int = number.int.replace(/^0+(?=\d)/, '') || '0';
        if (number.grouped) {
            int = int.replace(/\B(?=(\d{3})+$)/g, separators.group);
        }
        const body = number.prefix + int + (number.frac ? separators.decimal + number.frac : '') + number.suffix;
        if (number.negative && !isZero(number)) {
            return number.parens ? '(' + body + ')' : (number.sign === '−' ? '−' : '-') + body;
        }
        return (number.sign === '+' ? '+' : '') + body;
    };

    /* Digits `int` + `frac` as one string with `places` of them after the point, and back. */
    function split(digits, places) {
        const padded = digits.padStart(places + 1, '0');
        const int = padded.slice(0, padded.length - places).replace(/^0+(?=\d)/, '');
        return { int: int, frac: padded.slice(padded.length - places) };
    }

    /* The number with `places` decimals: rounded half up, or padded with zeros. A zero loses its minus. */
    App.numbers.withDecimals = function withDecimals(number, places) {
        if (places >= number.frac.length) {
            return Object.assign({}, number, { frac: number.frac.padEnd(places, '0') });
        }
        let digits = number.int + number.frac.slice(0, places);
        if (number.frac[places] >= '5') {
            digits = (BigInt(digits) + 1n).toString().padStart(digits.length, '0');
        }
        const result = Object.assign({}, number, split(digits, places));
        if (isZero(result) && result.sign !== '+') {
            Object.assign(result, { sign: '', negative: false, parens: false });
        }
        return result;
    };

    /* 0,195 -> 19,5%: the point moves two places right, no digit is lost. */
    App.numbers.toPercent = function toPercent(number) {
        const digits = number.int + number.frac;
        const places = number.frac.length - 2;
        const moved = places >= 0 ? split(digits, places) : split(digits + '0'.repeat(-places), 0);
        return Object.assign({}, number, moved, { suffix: '%' });
    };

    /* 19,5% -> 0,195. */
    App.numbers.fromPercent = function fromPercent(number) {
        return Object.assign({}, number, split(number.int + number.frac, number.frac.length + 2), { suffix: '' });
    };
})();
