/*
 * Clipboard fixtures for the paste tests (SPEC Phase 3, "Paste into text").
 *
 * Each file in this folder adds one { name, source, types: { 'text/html', 'text/plain' } }.
 * Real ones are captured with tests/clipboard-capture.html (fake text only).
 * Files marked synthetic: true were written by hand to look like that
 * program's output; replace them with real captures when available.
 */
const CLIPBOARD_FIXTURES = [];

function clipboardFixture(name) {
    const fixture = CLIPBOARD_FIXTURES.find((item) => item.name === name);
    if (!fixture) {
        throw new Error('No clipboard fixture named ' + name);
    }
    return fixture;
}
