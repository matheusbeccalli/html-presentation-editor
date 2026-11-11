# Vendored libraries

Every third-party library used by the editor is downloaded **once** during development,
stored here with its exact version and its `LICENSE` file, and pasted into `dist/editor.html`
by `build.py` (SPEC 2.2). Nothing is ever loaded from the internet at runtime.

Rules:

- Only permissive licenses: MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC. No GPL/AGPL.
- Each library lives in `vendor/<library>/` with the code file and its `LICENSE` next to it.
- Ask before adding a library (SPEC 8.2). Prefer writing small features ourselves.
- `build.py` reads the table below, checks the license name, checks that `LICENSE` exists,
  verifies the SHA-256 of the file and inlines the libraries **in table order**.
  A wrong hash stops the build.

To compute a hash: `python -c "import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" vendor/<lib>/<file>`

| Name | Version | License | Source URL | File | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| PptxGenJS | 4.0.1 | MIT | https://registry.npmjs.org/pptxgenjs/-/pptxgenjs-4.0.1.tgz (file `package/dist/pptxgen.bundle.js`; npm shasum cd0f202f62f74d950bcd217e90b766da8f73742e checked) | `pptxgenjs/pptxgen.bundle.js` | `4fb9eac5cfefb213e2d8743c2b7151025f31bfb3f834c73c12062916daa0f3f8` |

Notes:

- **PptxGenJS** (PowerPoint export, SPEC 7.4, added 2026-11-11 with the user's approval). Its browser bundle also holds
  **JSZip 3.10.1** ("MIT or GPLv3", used under MIT) with pako, lie, setImmediate and readable-stream (all MIT /
  zlib); their notices are in `pptxgenjs/LICENSE`. The editor uses that JSZip (global `JSZip`) for the PNG ZIP too
  (SPEC 7.3), so JSZip is not vendored separately. Checked under the editor's CSP: no blocked call (its one
  `XMLHttpRequest` only runs for a picture given by path, which the editor never does).
- **html2canvas** is not needed: the editor draws slide pictures with the browser itself (SPEC 7.3, Phase 8 Q&A).
