"""
handchecks.py - which e2e tests stand for which FEATURES.md hand check (used by run_edge.py).

key:   the start of the hand-check line in FEATURES.md (text after "  - [ ] ")
tests: e2e_test.py functions that replay it
auto:  True only when those tests assert EVERY clause of the check, so a pass in Edge
       may tick it. False: the line stays unticked and the report shows `left`.
left:  what the tests do not cover (still to do by hand)

A new hand check with no entry shows up in the report as "No test mapped".
"""

OFFICE = "needs the real Office clipboard (next part of the automation)"

HAND_CHECKS = [
    # ---- Phase 3 -----------------------------------------------------
    {"key": "Open a real Copilot deck from `private/`", "tests": [], "auto": False,
     "left": "your private decks never go through the automation"},
    {"key": "Type a misspelled Portuguese word", "tests": [], "auto": False,
     "left": "Edge's red spell-check underline is not visible to tests"},
    {"key": "Home > Paragraph, alignment and spacing", "tests": ['test_paragraph_formatting', 'test_gap_p3_paragraph'], "auto": False,
     "left": "Ctrl+R: a test's key press never reaches Edge's own reload, so the reload and its 'Leave site?' question are only imitated (the test shows the editor leaves Ctrl+R alone)"},
    {"key": "Paste: copy a 3-level bulleted list in Word", "tests": ["test_paste_into_text", "test_paste_options_button"],
     "auto": False, "left": "real Word/Outlook/Copilot/web copies: " + OFFICE},
    {"key": "Copy: select two bullets", "tests": ["test_copy_and_cut_text"], "auto": False,
     "left": "pasting into a new Outlook e-mail: " + OFFICE},
    {"key": "Format painter", "tests": ['test_format_painter', 'test_gap_p3_format_painter'], "auto": True},
    {"key": "Find & replace", "tests": ['test_find_and_replace', 'test_gap_p3_find_replace'], "auto": False,
     "left": "Ctrl+H never opening Edge's History is only shown indirectly (the editor takes the key)"},
    {"key": "Autofit", "tests": ['test_autofit', 'test_gap_p3_autofit'], "auto": True},
    # ---- Phase 4 -----------------------------------------------------
    {"key": "The whole journey in Edge, timed", "tests": ["test_phase4_done_when"], "auto": False,
     "left": "copying from Excel and the one-minute timing: " + OFFICE},
    {"key": "In Edge: open a deck saved before Phase 4", "tests": ['test_format1_deck_text_is_converted', 'test_gap_p4_format1_table'], "auto": False,
     "left": "'looks as before' is compared with the original file opened on its own (all 24 cells: header fill, alignment, bold Mediana with its line): accept or check by eye"},
    {"key": "Typing in cells", "tests": ['test_table_cell_editing', 'test_gap_p4_typing_new_row_undo'], "auto": True},
    {"key": "Layout tab", "tests": ['test_table_layout'], "auto": False,
     "left": "the test fails in Edge (2 px tolerance); 'Ctrl+Z each' only checked at the end; 'typing goes on' only after one insert; the Shift+click four-cell block not measured"},
    {"key": "Column borders", "tests": ['test_table_column_borders', 'test_gap_p4_column_borders'], "auto": True},
    {"key": "Table Design", "tests": ['test_table_design', 'test_gap_p4_table_design'], "auto": True},
    {"key": "Numbers: on slide 3", "tests": ['test_table_numbers', 'test_gap_p4_numbers'], "auto": False,
     "left": "'typing goes on' after Increase Decimal is not proven (only the editing flag is checked)"},
    {"key": "Paste from Excel: in Excel select", "tests": ["test_paste_from_excel"], "auto": False,
     "left": "copying from the real Excel: " + OFFICE},
    {"key": "Insert > Table: move the mouse", "tests": ['test_insert_and_resize_table', 'test_gap_p4_insert_table'], "auto": True},
    {"key": "Capture Excel fixtures", "tests": [], "auto": False,
     "left": "tests/fixtures/clipboard/excel-comps.js is already a real capture (2026-11-04); "
             "PowerPoint/Word table captures optional"},
    # ---- Phase 5 -----------------------------------------------------
    {"key": "Pictures: Insert > Pictures", "tests": ["test_insert_picture"], "auto": False, "left": "Ctrl+click of two files in the real dialog; where they land; one Ctrl+Z removes both; status bar growing; file size in Explorer"},
    {"key": "Drop and paste", "tests": ["test_paste_and_drop_pictures"], "auto": False,
     "left": "drag from Explorer, Win+Shift+S, Excel chart copy: real Windows gestures"},
    {"key": "Picture Format", "tests": ['test_picture_format'], "auto": False,
     "left": 'the picture is never clicked (selected by inserting it); the tab going away uses an internal select, not a click on a text box'},
    {"key": "Crop: select a picture", "tests": ["test_crop_picture"], "auto": False, "left": "black handles and the dimmed part (seen); file size compared after Save"},
    {"key": "Shapes: Insert > Shapes", "tests": ['test_insert_shapes', 'test_gap_p5_shapes'], "auto": True},
    {"key": "Shape Format", "tests": ['test_shape_format', 'test_gap_p5_shape_format'], "auto": True},
    {"key": "Text in shapes", "tests": ['test_shape_text', 'test_gap_p5_text_in_shapes'], "auto": True},
    {"key": "Shape handles", "tests": ['test_line_and_adjust_handles', 'test_gap_p5_shape_handles'], "auto": True},
    # ---- Phase 6 -----------------------------------------------------
    {"key": "Charts drawn", "tests": ['test_chart_rendering', 'test_gap_p6_charts_drawn'], "auto": False,
     "left": "the test closes the grid before Ctrl+Z, the hand check presses Ctrl+Z in the cell"},
    {"key": "Lines, combo, donut", "tests": ['test_chart_lines_combo_donut', 'test_gap_p6_lines_combo_donut'], "auto": False,
     "left": "contract deck slide 4 'looks as before' is compared with the file's own drawing"},
    {"key": "Waterfall: open", "tests": ['test_chart_waterfall', 'test_gap_p6_waterfall'], "auto": True},
    {"key": "More types", "tests": ['test_chart_types_priority_2', 'test_gap_p6_more_types'], "auto": True},
    {"key": "Readability", "tests": ['test_chart_readability', 'test_gap_p6_readability'], "auto": True},
    {"key": "Insert a chart", "tests": ['test_insert_chart_and_design', 'test_gap_p6_insert_chart'], "auto": True},
    {"key": "Data grid", "tests": ['test_chart_data_grid', 'test_gap_p6_data_grid'], "auto": True},
    {"key": "Paste from Excel: in Excel (a sheet", "tests": ["test_chart_paste_from_excel"], "auto": False,
     "left": "copying from the real Excel: " + OFFICE},
    {"key": "Label numbers", "tests": ['test_chart_label_numbers', 'test_gap_p6_label_numbers'], "auto": True},
    # ---- Phase 7 -----------------------------------------------------
    {"key": "Speaker notes", "tests": ["test_speaker_notes"], "auto": True},
    {"key": "Slides: Home > New Slide", "tests": ['test_add_duplicate_delete_slides', 'test_gap_p7b_new_slide'], "auto": False,
     "left": "'its title where your titles are' is only proven for Title Slide (the deck's content titles sit where the built-in default would put them anyway)"},
    {"key": "Reorder and hide", "tests": ['test_reorder_and_hide_slides', 'test_saved_deck_presents_on_its_own'], "auto": False,
     "left": "the red drop line's place and colour, 'dimmed' and the crossed-out eye not checked as seen; the deck this test saves is never presented"},
    {"key": "Multi-select", "tests": ['test_multi_select', 'test_gap_p7b_multi_select'], "auto": True},
    {"key": "Align and distribute", "tests": ['test_align_and_distribute', 'test_gap_p7b_align'], "auto": True},
    {"key": "Smart guides", "tests": ['test_smart_guides_gridlines_and_rulers', 'test_gap_p7b_smart_guides'], "auto": True},
    {"key": "Group:", "tests": ['test_group_and_ungroup', 'test_gap_p7b_group'], "auto": True},
    {"key": "Rotate:", "tests": ["test_rotate", "test_gap_rotate"], "auto": True},
    {"key": "Lock:", "tests": ["test_lock", "test_gap_lock"], "auto": True},
    {"key": "Slide master: View > Slide Master", "tests": ['test_slide_master', 'test_gap_p7b_slide_master'], "auto": False,
     "left": "Ctrl+P: the print is imitated (print media on the saved file), not Edge's print dialog"},
    {"key": "Slide master on a Copilot deck", "tests": ['test_slide_master_own_footers', 'test_gap_p7b_master_own_footers'], "auto": False,
     "left": 'a real Copilot deck: the test uses a made-up deck with its own footers (6 slides); no sample deck has them'},
    {"key": "Theme: Design > Edit Theme", "tests": ["test_theme_editor", "test_phase7_done_when"], "auto": False,
     "left": "the thumbnails following the new theme (not checked); a deck you saved yourself (tests use made-up ones)"},
]
