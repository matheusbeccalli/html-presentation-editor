/*
 * harness.js - a tiny test runner for run-tests.html (no libraries needed).
 *
 * Usage inside a *.test.js file:
 *     test('history: undo restores the slide', async () => {
 *         assertEqual(actual, expected);
 *     });
 *
 * Python comparison: this is a miniature version of pytest. `test()` registers
 * a function (like a `def test_...():`), and `runAllTests()` calls each one,
 * catching exceptions the way pytest reports a failed assert.
 *
 * Results are drawn on the page and also stored in window.__testResults so
 * tests/run_tests.py (Playwright) can read them in a headless browser.
 */

const registeredTests = [];

function test(name, fn) {
    registeredTests.push({ name: name, fn: fn });
}

class AssertionError extends Error {}

function assert(condition, message) {
    if (!condition) {
        throw new AssertionError(message || 'assertion failed');
    }
}

// Deep comparison through JSON: good enough for numbers, strings, arrays and plain objects.
function assertEqual(actual, expected, message) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        throw new AssertionError((message ? message + ': ' : '') + 'expected ' + e + ' but got ' + a);
    }
}

function assertIncludes(text, fragment, message) {
    if (String(text).indexOf(fragment) === -1) {
        const shown = String(text).slice(0, 200);
        throw new AssertionError((message ? message + ': ' : '') + 'expected to find "' + fragment + '" in "' + shown + '"');
    }
}

function assertNotIncludes(text, fragment, message) {
    if (String(text).indexOf(fragment) !== -1) {
        throw new AssertionError((message ? message + ': ' : '') + 'did not expect to find "' + fragment + '"');
    }
}

function assertThrows(fn, message) {
    let threw = false;
    try {
        fn();
    } catch (error) {
        threw = true;
    }
    assert(threw, message || 'expected the function to throw');
}

// Helper used by many tests: turn an HTML string into a Document without rendering it.
function parseDoc(html) {
    return new DOMParser().parseFromString(html, 'text/html');
}

async function runAllTests() {
    const results = { passed: 0, failed: 0, failures: [], done: false };
    const list = document.getElementById('results');

    for (const t of registeredTests) {
        const row = document.createElement('li');
        try {
            await t.fn();
            results.passed += 1;
            row.className = 'pass';
            row.textContent = 'PASS  ' + t.name;
        } catch (error) {
            results.failed += 1;
            results.failures.push({ name: t.name, message: String(error && error.message || error) });
            row.className = 'fail';
            row.textContent = 'FAIL  ' + t.name + '  —  ' + (error && error.message || error);
        }
        list.appendChild(row);
    }

    const summary = document.getElementById('summary');
    summary.textContent = results.passed + ' passed, ' + results.failed + ' failed';
    summary.className = results.failed ? 'fail' : 'pass';
    results.done = true;
    window.__testResults = results;
}
