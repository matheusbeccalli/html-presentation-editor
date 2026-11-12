"""
build.py - merges src/ and vendor/ into the single file dist/editor.html.

Uses only the Python standard library, so it also runs on the company machine.

How it works (SPEC 3.2):
  1. Read src/index.html. It contains markers such as
         <!-- INLINE-CSS: css/editor.css -->
         <!-- INLINE-JS: js/app.js -->
         <!-- INLINE-TEXT: player/player.js #deck-player-js -->
         <!-- INLINE-VENDOR -->
  2. Replace every marker with the contents of that file:
         INLINE-CSS    -> <style> ... </style>
         INLINE-JS     -> <script> ... </script>
         INLINE-TEXT   -> <script type="text/plain" id="..."> ... </script>
                          (code that is NOT run by the editor, only copied into
                          saved decks, e.g. the slide player)
         INLINE-ABOUT  -> <script type="application/json" id="about-data">: the
                          vendored libraries and their licenses, for Help > About
         INLINE-VENDOR -> every library listed in vendor/README.md, each with
                          its license as a comment. Placed before our own JS so
                          vendor code is always loaded first.
  3. Run the offline checks and refuse to write a file that could reach the
     network:
       - no http:// or https:// inside src=, href= or url(
       - the Content-Security-Policy meta tag is present
       - our own JS never calls fetch, XMLHttpRequest, WebSocket, etc.
  4. Print the output size.

Usage:
    python build.py
Exit code 0 = success, 1 = any check failed (the message says why).
"""

import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
VENDOR = ROOT / "vendor"
DIST = ROOT / "dist"
OUTPUT = DIST / "editor.html"

# A marker looks like: <!-- INLINE-JS: js/app.js -->
# Group 1 = kind (CSS, JS, TEXT), group 2 = the rest (path and options).
MARKER_RE = re.compile(r"<!--\s*INLINE-(CSS|JS|TEXT):\s*(.+?)\s*-->")
VENDOR_MARKER = "<!-- INLINE-VENDOR -->"
ABOUT_MARKER = "<!-- INLINE-ABOUT -->"

# The offline guarantee (SPEC 3.2): a remote URL inside src=, href= or url(.
REMOTE_REF_RE = re.compile(
    r"""(?:\b(?:src|href)\s*=\s*["']?\s*|\burl\(\s*["']?\s*)https?://""",
    re.IGNORECASE,
)

# Network APIs our own code must never use (SPEC 2.3). Checked in src/ only,
# because vendored libraries may contain such code paths that we never call.
FORBIDDEN_APIS = ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon"]

REQUIRED_CSP = (
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
    "img-src data: blob:; font-src data:; connect-src 'none'; "
    "frame-src 'self' blob:; child-src 'self' blob:"
)


class BuildError(Exception):
    """Raised for any problem that must stop the build."""


def read_source(relative_path):
    """Read a file from src/ as UTF-8 text, with a clear error if it is missing."""
    path = SRC / relative_path
    if not path.is_file():
        raise BuildError(f"Marker points to a missing file: src/{relative_path}")
    return path.read_text(encoding="utf-8")


def guard_closing_tag(text, tag, label):
    """
    A file pasted inside <script> must not contain "</script" (and CSS inside
    <style> must not contain "</style"), or the browser would end the tag early.
    """
    if f"</{tag}" in text.lower():
        raise BuildError(f"{label} contains '</{tag}' which would break the inlined <{tag}> tag")


def check_forbidden_apis(text, label):
    for api in FORBIDDEN_APIS:
        if api in text:
            raise BuildError(f"{label} uses the network API '{api}' (forbidden by SPEC 2.3)")


def replace_marker(match):
    """Turn one INLINE-* marker into a <style> or <script> tag with the file's contents."""
    kind, argument = match.group(1), match.group(2)

    if kind == "CSS":
        css = read_source(argument)
        guard_closing_tag(css, "style", f"src/{argument}")
        return f"<style>\n/* ---- {argument} ---- */\n{css}\n</style>"

    if kind == "JS":
        js = read_source(argument)
        guard_closing_tag(js, "script", f"src/{argument}")
        check_forbidden_apis(js, f"src/{argument}")
        return f"<script>\n// ---- {argument} ----\n{js}\n</script>"

    # INLINE-TEXT: "player/player.js #deck-player-js"
    parts = argument.split()
    if len(parts) != 2 or not parts[1].startswith("#"):
        raise BuildError(f"INLINE-TEXT needs 'path #id', got: {argument}")
    path, element_id = parts[0], parts[1][1:]
    text = read_source(path)
    guard_closing_tag(text, "script", f"src/{path}")
    check_forbidden_apis(text, f"src/{path}")
    return f'<script type="text/plain" id="{element_id}">\n{text}\n</script>'


def read_vendor_table():
    """
    Read the library table in vendor/README.md.

    Each library row has these columns:
      | Name | Version | License | Source URL | File | SHA-256 |
    "File" is relative to vendor/, e.g. pptxgenjs/pptxgen.bundle.js.
    Returns a list of dicts. Rows without a file (the header, the separator
    line, or an empty table) are skipped.
    """
    readme = VENDOR / "README.md"
    if not readme.is_file():
        raise BuildError("vendor/README.md is missing (SPEC 2.2)")

    libraries = []
    for line in readme.read_text(encoding="utf-8").splitlines():
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) != 6 or cells[0] in ("Name", "") or cells[0].startswith("-"):
            continue
        name, version, license_name, url, file_name, sha256 = cells
        libraries.append({
            "name": name, "version": version, "license": license_name,
            "url": url, "file": file_name.strip("`"), "sha256": sha256.strip("`").lower(),
        })
    return libraries


def build_vendor_block():
    """Inline each vendored library, preceded by its LICENSE file as a comment."""
    allowed_licenses = {"MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC"}
    blocks = []

    for lib in read_vendor_table():
        if lib["license"] not in allowed_licenses:
            raise BuildError(f"{lib['name']}: license '{lib['license']}' is not allowed (SPEC 2.2)")

        code_path = VENDOR / lib["file"]
        license_path = code_path.parent / "LICENSE"
        if not code_path.is_file():
            raise BuildError(f"{lib['name']}: file vendor/{lib['file']} not found")
        if not license_path.is_file():
            raise BuildError(f"{lib['name']}: LICENSE file missing next to vendor/{lib['file']}")

        code_bytes = code_path.read_bytes()
        actual_hash = hashlib.sha256(code_bytes).hexdigest()
        if actual_hash != lib["sha256"]:
            raise BuildError(
                f"{lib['name']}: SHA-256 mismatch. README says {lib['sha256']}, file is {actual_hash}"
            )

        code = code_bytes.decode("utf-8")
        guard_closing_tag(code, "script", f"vendor/{lib['file']}")
        # "*/" inside the license text would end the comment early.
        license_text = license_path.read_text(encoding="utf-8").replace("*/", "* /")
        blocks.append(
            f"<script>\n/*! {lib['name']} {lib['version']} ({lib['license']}) - {lib['url']}\n"
            f"{license_text}\n*/\n{code}\n</script>"
        )

    return "\n".join(blocks)


def read_bundled_table():
    """
    Read vendor/README.md's second table, the libraries bundled inside a vendored one:
      | Inside | Name | Version | License |
    Returns {library name: [{name, version, license}]}.
    """
    bundled = {}
    for line in (VENDOR / "README.md").read_text(encoding="utf-8").splitlines():
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) != 4 or cells[0] in ("Inside", "") or cells[0].startswith("-"):
            continue
        inside, name, version, license_name = cells
        bundled.setdefault(inside, []).append({"name": name, "version": version, "license": license_name})
    return bundled


def about_data():
    """
    What Help > About shows (SPEC 2.2): every vendored library with its version, license,
    source, SHA-256, full LICENSE text and the libraries bundled inside it. (No build date: it would
    change dist/editor.html on every day it is rebuilt, with nothing else changed.)
    """
    bundled = read_bundled_table()
    libraries = []
    for lib in read_vendor_table():
        license_path = (VENDOR / lib["file"]).parent / "LICENSE"
        libraries.append({
            "name": lib["name"], "version": lib["version"], "license": lib["license"],
            "url": lib["url"], "sha256": lib["sha256"],
            "licenseText": license_path.read_text(encoding="utf-8") if license_path.is_file() else "",
            "bundled": bundled.get(lib["name"], []),
        })
    return {"libraries": libraries}


def build_about_block():
    """The About data as JSON text in the page (never run: type application/json)."""
    text = json.dumps(about_data(), ensure_ascii=False, indent=1)
    # "</" would end the script element early; JSON allows "<\/" for "</".
    text = text.replace("</", "<\\/")
    return f'<script type="application/json" id="about-data">\n{text}\n</script>'


def find_remote_references(html):
    """Return (line_number, snippet) for every remote URL in src=, href= or url(."""
    found = []
    for match in REMOTE_REF_RE.finditer(html):
        line_number = html.count("\n", 0, match.start()) + 1
        snippet = html[match.start():match.start() + 80].splitlines()[0]
        found.append((line_number, snippet))
    return found


def build():
    template = read_source("index.html")

    if VENDOR_MARKER not in template:
        raise BuildError(f"src/index.html must contain {VENDOR_MARKER}")
    # Our own markers first, so text inside vendor code is never taken for a marker.
    html = MARKER_RE.sub(replace_marker, template)
    html = html.replace(VENDOR_MARKER, build_vendor_block())
    html = html.replace(ABOUT_MARKER, build_about_block())

    # ---- Offline checks (the build refuses to write an unsafe file) ----
    remote = find_remote_references(html)
    if remote:
        details = "\n".join(f"  line {line}: {snippet}" for line, snippet in remote)
        raise BuildError(f"Remote references found in the output (SPEC 3.2):\n{details}")

    if REQUIRED_CSP not in html:
        raise BuildError("The Content-Security-Policy meta tag from SPEC 2.3 is missing or changed")

    leftover = re.search(r"<!--\s*INLINE-[A-Z]+", html)
    if leftover:
        raise BuildError(f"Unrecognised marker left in output: {leftover.group(0)}")

    DIST.mkdir(exist_ok=True)
    OUTPUT.write_text(html, encoding="utf-8", newline="\n")
    return OUTPUT.stat().st_size


def main():
    try:
        size = build()
    except BuildError as error:
        print(f"BUILD FAILED: {error}", file=sys.stderr)
        return 1
    print(f"Built {OUTPUT.relative_to(ROOT)}  ({size / 1024:.1f} KB)")
    print("Offline check passed: no remote src=/href=/url(), CSP present, no network APIs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
