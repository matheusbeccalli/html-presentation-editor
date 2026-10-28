"""
run_tests.py - runs every automated test from the command line (at home, SPEC 8.3).

  1. build.py unit tests (Python unittest)          -> always
  2. tests/run-tests.html in headless Chromium      -> needs Playwright for Python
  3. tests/e2e_test.py end-to-end tests             -> needs Playwright for Python

On the company machine (no Playwright) just double-click tests/run-tests.html instead.

Usage:  python tests/run_tests.py
"""

import subprocess
import sys
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent
ROOT = TESTS.parent


def run_build_tests():
    print("== build.py unit tests ==")
    suite = unittest.defaultTestLoader.discover(str(TESTS), pattern="test_build.py")
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    return result.wasSuccessful()


def run_browser_unit_tests():
    print("\n== browser unit tests (tests/run-tests.html) ==")
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto((TESTS / "run-tests.html").as_uri())
        page.wait_for_function("window.__testResults && window.__testResults.done", timeout=60000)
        results = page.evaluate("window.__testResults")
        browser.close()

    for failure in results["failures"]:
        print(f"  FAIL {failure['name']}\n       {failure['message']}")
    for error in errors:
        print(f"  PAGE ERROR {error}")
    print(f"  {results['passed']} passed, {results['failed']} failed")
    return results["failed"] == 0 and not errors


def run_e2e_tests():
    print("\n== end-to-end tests (tests/e2e_test.py) ==")
    completed = subprocess.run([sys.executable, str(TESTS / "e2e_test.py")], cwd=ROOT)
    return completed.returncode == 0


def main():
    ok = run_build_tests()
    try:
        import playwright  # noqa: F401
    except ImportError:
        print("\nPlaywright is not installed: open tests/run-tests.html in the browser instead.")
        return 0 if ok else 1
    ok = run_browser_unit_tests() and ok
    ok = run_e2e_tests() and ok
    print("\nALL TESTS PASSED" if ok else "\nSOME TESTS FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
