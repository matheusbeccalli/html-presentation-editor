"""
How a gap module looks (files starting with _ are skipped by run_edge.py).

    import e2e_test as e2e                      # helpers: Editor, check, wait_until, drag, slide_to_screen, ...
    from e2e_test import Editor, check, wait_until

    def test_gap_lock(browser):
        editor = Editor(browser)
        editor.open(e2e.CONTRACT)
        ...
        editor.page.screenshot(path=str(e2e.OUTPUT / "gap-lock.png"))   # always e2e.OUTPUT (set at run time)
        check(editor.errors == [], f"no errors: {editor.errors}")
        editor.close()

    TESTS = [test_gap_lock]
"""
TESTS = []
