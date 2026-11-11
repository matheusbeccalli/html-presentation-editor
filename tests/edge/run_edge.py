"""
run_edge.py - runs the end-to-end tests in the real Microsoft Edge on Windows and
ticks the FEATURES.md hand checks whose Edge tests pass. Home only, not in Git.

What it does:
  1. runs every test of tests/e2e_test.py in Edge (not headless Chromium);
     screenshots and saved decks go to tests/output/edge/
  2. matches each unticked hand check of FEATURES.md (`  - [ ] ...`) to its tests
     through the table in handchecks.py
  3. ticks a hand check when its tests all passed AND the table says the test
     covers the whole check ("auto"); the line gets a note "(ticked by the Edge run, date)"
  4. writes tests/output/edge/handcheck-report.html: every hand check, its tests,
     pass/fail, what is still left to do by hand, and the screenshots

Usage (from WSL or Windows):
    python3 tests/edge/run_edge.py              all tests, headless Edge, ticks
    python3 tests/edge/run_edge.py --headed     watch Edge do it
    python3 tests/edge/run_edge.py --no-tick    report only, FEATURES.md untouched
    python3 tests/edge/run_edge.py -k slide     only tests whose name contains "slide" (several: -k lock,rotate)

Needs, on Windows: py -m pip install --user playwright   (uses the installed Edge)
"""

import argparse
import datetime
import html
import re
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
TESTS_DIR = HERE.parent
ROOT = TESTS_DIR.parent
FEATURES = ROOT / "FEATURES.md"
OPEN_PROFILES = set()   # profiles already cleared in this run


def relaunch_on_windows():
    """From WSL: run this same file with the Windows Python, so Playwright drives the Windows Edge."""
    windows_path = subprocess.check_output(["wslpath", "-w", str(Path(__file__).resolve())], text=True).strip()
    command = ["cmd.exe", "/c", "py", windows_path, *sys.argv[1:]]
    # cmd.exe cannot start in a \\wsl.localhost folder, so start it in C:\.
    return subprocess.call(command, cwd="/mnt/c")


# ----------------------------------------------------------------------
# FEATURES.md
# ----------------------------------------------------------------------

def unticked_hand_checks(text):
    """(line index, text after the box) of every unticked indented check line."""
    found = []
    for index, line in enumerate(text.splitlines(keepends=True)):
        if line.startswith("  - [ ] "):
            found.append((index, line[len("  - [ ] "):].rstrip("\r\n")))
    return found


TICK_NOTE = re.compile(r" \*\(ticked by the Edge run, \d{4}-\d{2}-\d{2}\)\*$")


def machine_ticked_hand_checks(text):
    """(line index, text without the note) of every hand check this run ticked earlier (it has the note)."""
    found = []
    for index, line in enumerate(text.splitlines(keepends=True)):
        body = line.rstrip("\r\n")
        if body.startswith("  - [x] ") and TICK_NOTE.search(body):
            found.append((index, TICK_NOTE.sub("", body[len("  - [x] "):])))
    return found


def untick_lines(texts):
    """Take back the Edge run's own ticks on these lines (never a tick without the note: those are the user's)."""
    lines = FEATURES.read_bytes().decode("utf-8").splitlines(keepends=True)
    unticked = []
    for text in texts:
        hits = [i for i, line in enumerate(lines)
                if line.startswith("  - [x] " + text) and TICK_NOTE.search(line.rstrip("\r\n"))
                and TICK_NOTE.sub("", line.rstrip("\r\n")) == "  - [x] " + text]
        if len(hits) != 1:
            print(f"  NOT UNTICKED (line changed or not unique): {text[:70]}")
            continue
        line = lines[hits[0]]
        ending = line[len(line.rstrip("\r\n")):]
        lines[hits[0]] = "  - [ ] " + text + ending
        unticked.append(text)
    FEATURES.write_bytes("".join(lines).encode("utf-8"))
    return unticked


def match(check_text, table):
    for entry in table:
        if check_text.startswith(entry["key"]):
            return entry
    return None


def tick_lines(texts, note):
    """Tick the unticked lines with exactly these texts; everything else (and the line endings) untouched.
    Found by text, not line number, because FEATURES.md may be edited while the tests run."""
    lines = FEATURES.read_bytes().decode("utf-8").splitlines(keepends=True)
    ticked = []
    for text in texts:
        hits = [i for i, line in enumerate(lines) if line.rstrip("\r\n") == "  - [ ] " + text]
        if len(hits) != 1:
            print(f"  NOT TICKED (line changed or not unique): {text[:70]}")
            continue
        line = lines[hits[0]]
        ending = line[len(line.rstrip("\r\n")):]
        lines[hits[0]] = "  - [x] " + text + f" *({note})*" + ending
        ticked.append(text)
    FEATURES.write_bytes("".join(lines).encode("utf-8"))
    return ticked


# ----------------------------------------------------------------------
# Running the tests in Edge
# ----------------------------------------------------------------------

def outputs_snapshot(folder):
    return {p: p.stat().st_mtime for p in folder.rglob("*") if p.is_file() and "profile" not in p.parts[-2]}


def gap_tests():
    """The extra tests in tests/edge/gaps/*.py (each module has a TESTS list): the hand-check steps
    the tests of e2e_test.py leave out. They run after e2e_test's own tests."""
    import importlib
    found = []
    for module_file in sorted((HERE / "gaps").glob("*.py")):
        if module_file.name.startswith("_"):
            continue
        module = importlib.import_module(f"gaps.{module_file.stem}")
        found.extend(module.TESTS)
    return found


def run_tests(e2e, names_filter, headed):
    from playwright.sync_api import sync_playwright

    results = {}   # test name -> {"ok": bool, "error": str, "seconds": float, "files": [Path]}
    wanted = [w.strip() for w in names_filter.split(",") if w.strip()]
    tests = [t for t in e2e.TESTS + gap_tests() if not wanted or any(w in t.__name__ for w in wanted)]
    with sync_playwright() as p:
        e2e.PLAYWRIGHT = p
        launch_options = {"channel": "msedge", "headless": not headed}

        def launch_profile(profile):
            # Same as e2e_test.launch_profile, but in Edge, and the profile in the Windows temp
            # folder: Edge's storage (IndexedDB) does not work in a \\wsl.localhost folder.
            local = Path(tempfile.gettempdir()) / "deck-editor-edge" / Path(profile).name
            if not local.exists() or Path(profile).name not in OPEN_PROFILES:
                shutil.rmtree(local, ignore_errors=True)   # a fresh profile per test, like the original
                OPEN_PROFILES.add(Path(profile).name)
            return p.chromium.launch_persistent_context(
                str(local), viewport={"width": 1440, "height": 900}, accept_downloads=True, **launch_options)
        e2e.launch_profile = launch_profile

        browser = p.chromium.launch(**launch_options)
        EDGE_VERSION["v"] = f"Edge {browser.version}" + ("" if headed else " (headless)")
        print(f"{EDGE_VERSION['v']}, {len(tests)} tests")
        for test in tests:
            before = outputs_snapshot(e2e.OUTPUT)
            started = time.time()
            try:
                test(browser)
                results[test.__name__] = {"ok": True, "error": ""}
                print(f"  PASS {test.__name__}")
            except Exception as error:  # noqa: BLE001 - report every kind of failure
                message = str(error) if isinstance(error, AssertionError) else traceback.format_exc()
                results[test.__name__] = {"ok": False, "error": message}
                print(f"  FAIL {test.__name__}: {str(error)[:300]}")
            after = outputs_snapshot(e2e.OUTPUT)
            results[test.__name__]["seconds"] = time.time() - started
            results[test.__name__]["files"] = sorted(f for f, m in after.items() if before.get(f) != m)
        browser.close()
    return results


# ----------------------------------------------------------------------
# Report
# ----------------------------------------------------------------------

REPORT_CSS = """
:root { --bg:#fff; --fg:#1b1b1b; --muted:#666; --line:#ddd; --ok:#1e7d32; --bad:#c62828; --warn:#b26a00; --card:#f7f7f7; }
@media (prefers-color-scheme: dark) { :root { --bg:#1e1e1e; --fg:#eee; --muted:#aaa; --line:#444;
  --ok:#66bb6a; --bad:#ef5350; --warn:#ffb74d; --card:#2a2a2a; } }
body { background:var(--bg); color:var(--fg); font:14px/1.45 "Segoe UI", system-ui, sans-serif; margin:0 auto;
  max-width:1100px; padding:16px; }
h1 { font-size:20px; } .muted { color:var(--muted); }
.check { border:1px solid var(--line); border-radius:8px; padding:10px 12px; margin:10px 0; background:var(--card); }
.badge { display:inline-block; font-weight:600; padding:1px 8px; border-radius:10px; border:1px solid currentColor;
  margin-right:6px; font-size:12px; }
.ticked { color:var(--ok); } .failed { color:var(--bad); } .left { color:var(--warn); } .none { color:var(--muted); }
.text { margin:6px 0; } .left-to-do { margin:4px 0; } pre { white-space:pre-wrap; font-size:12px; }
.shots { display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; }
.shots img { max-width:260px; max-height:170px; border:1px solid var(--line); border-radius:4px; }
.files a { margin-right:10px; }
"""


def build_report(rows, results, edge_version, report_path):
    def link(path):
        return path.relative_to(report_path.parent).as_posix()

    counts = {}
    for row in rows:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    labels = {"kept": "Ticked, still passing", "unticked": "Ticked before, now FAILS", "ticked": "Ticked", "left": "Passed, rest by hand", "failed": "Test failed",
              "manual": "By hand only", "unmapped": "No test mapped"}
    summary = " · ".join(f"{labels[k]}: {v}" for k, v in counts.items())
    out = [f"<!doctype html><html lang=en><head><meta charset=utf-8>"
           f"<meta name=viewport content='width=device-width, initial-scale=1'>"
           f"<title>Edge hand checks</title><style>{REPORT_CSS}</style></head><body>",
           f"<h1>Hand checks run in Edge</h1><p class=muted>{html.escape(edge_version)} · "
           f"{datetime.datetime.now():%Y-%m-%d %H:%M} · {html.escape(summary)}</p>"]
    for row in rows:
        css = {"ticked": "ticked", "kept": "ticked", "failed": "failed", "unticked": "failed", "left": "left"}.get(row["status"], "none")
        out.append(f"<div class=check><span class='badge {css}'>{labels[row['status']]}</span>"
                   f"<span class=muted>FEATURES.md line {row['line']}</span>"
                   f"<div class=text>{html.escape(row['text'])}</div>")
        if row.get("left"):
            out.append(f"<div class='left-to-do left'>Still by hand: {html.escape(row['left'])}</div>")
        for name in row.get("tests", []):
            result = results.get(name)
            if result is None:
                out.append(f"<div class=muted>{name}: not run</div>")
                continue
            state = "PASS" if result["ok"] else "FAIL"
            out.append(f"<div><b class={'ticked' if result['ok'] else 'failed'}>{state}</b> {name} "
                       f"<span class=muted>({result['seconds']:.1f} s)</span></div>")
            if result["error"]:
                out.append(f"<pre class=failed>{html.escape(result['error'][:3000])}</pre>")
            images = [f for f in result["files"] if f.suffix == ".png"]
            others = [f for f in result["files"] if f.suffix in (".html", ".pdf")]
            if images:
                out.append("<div class=shots>" + "".join(
                    f"<a href='{link(f)}'><img src='{link(f)}' alt='{html.escape(f.name)}' loading=lazy></a>"
                    for f in images) + "</div>")
            if others:
                out.append("<div class=files>" + "".join(
                    f"<a href='{link(f)}'>{html.escape(f.name)}</a>" for f in others) + "</div>")
        out.append("</div>")
    out.append("</body></html>")
    report_path.write_text("\n".join(out), encoding="utf-8")


# ----------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--headed", action="store_true", help="show the Edge window")
    parser.add_argument("--no-tick", action="store_true", help="do not change FEATURES.md")
    parser.add_argument("-k", dest="filter", default="", help="only tests whose name contains this (several: a,b,c)")
    args = parser.parse_args()

    if sys.platform != "win32":
        return relaunch_on_windows()

    sys.path.insert(0, str(TESTS_DIR))
    sys.path.insert(0, str(HERE))
    import e2e_test as e2e
    from handchecks import HAND_CHECKS

    if not e2e.EDITOR.exists():
        print("dist/editor.html is missing: run python3 build.py first")
        return 1
    e2e.OUTPUT = TESTS_DIR / "output" / "edge"
    e2e.OUTPUT.mkdir(parents=True, exist_ok=True)

    results = run_tests(e2e, args.filter, args.headed)

    # Match the unticked hand checks (read fresh: the run takes minutes).
    rows, to_tick = [], []
    for index, text in unticked_hand_checks(FEATURES.read_text(encoding="utf-8")):
        entry = match(text, HAND_CHECKS)
        row = {"line": index + 1, "text": text}
        if entry is None:
            row["status"] = "unmapped"
        else:
            row["tests"] = entry["tests"]
            row["left"] = entry.get("left", "")
            ran = [results.get(name) for name in entry["tests"]]
            if not entry["tests"]:
                row["status"] = "manual"
            elif any(r is None for r in ran):
                row["status"] = "manual" if args.filter else "failed"
                if args.filter:
                    row["left"] = (row["left"] + " " if row["left"] else "") + "(tests not run: -k filter)"
            elif not all(r["ok"] for r in ran):
                row["status"] = "failed"
            elif entry["auto"]:
                row["status"] = "ticked"
                to_tick.append(text)
            else:
                row["status"] = "left"
        rows.append(row)

    # The run's own earlier ticks: a failing test takes its tick back (the user's own ticks are never touched).
    to_untick = []
    for index, text in machine_ticked_hand_checks(FEATURES.read_text(encoding="utf-8")):
        entry = match(text, HAND_CHECKS)
        if entry is None or not entry["tests"]:
            continue
        ran = [results.get(name) for name in entry["tests"]]
        if any(r is None for r in ran):
            continue   # not run this time (-k): nothing to say
        row = {"line": index + 1, "text": text, "tests": entry["tests"], "left": ""}
        if all(r["ok"] for r in ran):
            row["status"] = "kept"
        else:
            row["status"] = "unticked"
            row["left"] = "its test failed: the Edge run took its tick back" if not args.no_tick else \
                "its test failed (--no-tick: still ticked in FEATURES.md)"
            to_untick.append(text)
        rows.append(row)
    rows.sort(key=lambda row: row["line"])
    unticked = untick_lines(to_untick) if to_untick and not args.no_tick else []

    ticked = []
    if to_tick and not args.no_tick:
        ticked = tick_lines(to_tick, f"ticked by the Edge run, {datetime.date.today():%Y-%m-%d}")
        for row in rows:
            if row["status"] == "ticked" and row["text"] not in ticked:
                row["status"] = "left"
                row["left"] = "passed, but the line changed during the run: run again"
    elif args.no_tick:
        for row in rows:
            if row["status"] == "ticked":
                row["status"] = "left"
                row["left"] = "nothing (would be ticked; --no-tick)"

    # A -k run writes its own report, so the full run's report is kept.
    report = e2e.OUTPUT / ("handcheck-report-k.html" if args.filter else "handcheck-report.html")
    build_report(rows, results, EDGE_VERSION.get("v", "Edge"), report)
    failed = [n for n, r in results.items() if not r["ok"]]
    print(f"\n  {len(results) - len(failed)} passed, {len(failed)} failed in Edge")
    print(f"  hand checks ticked: {len(ticked)}")
    if to_untick:
        print(f"  hand checks whose test FAILED: {len(to_untick)} ({'ticks taken back' if unticked else 'not changed: --no-tick'})")
        for text in to_untick:
            print(f"    - {text[:90]}")
    print(f"  report (open in Edge): {report}")
    return 1 if failed else 0


EDGE_VERSION = {}

if __name__ == "__main__":
    sys.exit(main())
