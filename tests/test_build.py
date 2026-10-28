"""
Unit tests for build.py (standard library unittest, runs anywhere Python runs).

Run:  python -m unittest tests/test_build.py
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build  # noqa: E402  (import after adjusting the path)


class RemoteReferenceCheck(unittest.TestCase):
    def test_flags_remote_script_src(self):
        found = build.find_remote_references('<script src="https://cdn.example.com/x.js"></script>')
        self.assertEqual(len(found), 1)

    def test_flags_remote_stylesheet_href_without_quotes(self):
        self.assertEqual(len(build.find_remote_references("<link href=http://x.com/a.css>")), 1)

    def test_flags_remote_css_url(self):
        self.assertEqual(len(build.find_remote_references("a{background:url( 'https://x.com/a.png')}")), 1)

    def test_reports_line_number(self):
        found = build.find_remote_references('line1\nline2\n<img src="https://x.com/a.png">')
        self.assertEqual(found[0][0], 3)

    def test_ignores_data_uris_and_svg_namespace(self):
        html = '<img src="data:image/png;base64,AAAA"><svg xmlns="http://www.w3.org/2000/svg"></svg>'
        self.assertEqual(build.find_remote_references(html), [])

    def test_ignores_urls_in_plain_text(self):
        self.assertEqual(build.find_remote_references("see https://example.com for details"), [])


class MarkerReplacement(unittest.TestCase):
    def test_text_marker_requires_id(self):
        match = build.MARKER_RE.search("<!-- INLINE-TEXT: player/player.js -->")
        with self.assertRaises(build.BuildError):
            build.replace_marker(match)

    def test_missing_file_is_a_build_error(self):
        match = build.MARKER_RE.search("<!-- INLINE-JS: js/does-not-exist.js -->")
        with self.assertRaises(build.BuildError):
            build.replace_marker(match)

    def test_closing_script_tag_is_rejected(self):
        with self.assertRaises(build.BuildError):
            build.guard_closing_tag("var s = '</script>';", "script", "test")

    def test_network_api_is_rejected(self):
        with self.assertRaises(build.BuildError):
            build.check_forbidden_apis("window.fetch('/x')", "test")


class TestPageMatchesEditor(unittest.TestCase):
    def test_run_tests_page_loads_the_same_js_files_in_the_same_order(self):
        import re
        index = (build.SRC / "index.html").read_text(encoding="utf-8")
        tests_page = (Path(__file__).parent / "run-tests.html").read_text(encoding="utf-8")
        editor_order = re.findall(r"INLINE-JS:\s*(js/[\w.-]+)", index)
        test_order = re.findall(r'src="\.\./src/(js/[\w.-]+)"', tests_page)
        self.assertEqual(test_order, editor_order)


class FullBuild(unittest.TestCase):
    def test_build_succeeds_and_output_is_offline(self):
        size = build.build()
        self.assertGreater(size, 1000)
        html = build.OUTPUT.read_text(encoding="utf-8")
        self.assertEqual(build.find_remote_references(html), [])
        self.assertIn(build.REQUIRED_CSP, html)
        self.assertNotIn("INLINE-", html)


if __name__ == "__main__":
    unittest.main()
