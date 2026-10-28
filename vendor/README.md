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

*(No libraries yet. Phase 8 will add PptxGenJS and html2canvas.)*
