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
    {"key": "Layout tab", "tests": ['test_table_layout', 'test_table_layout_undo_keeps_the_typing_cell', 'test_gap_p4_layout_tab'], "auto": True},
    {"key": "Column borders", "tests": ['test_table_column_borders', 'test_gap_p4_column_borders'], "auto": True},
    {"key": "Table Design", "tests": ['test_table_design', 'test_gap_p4_table_design'], "auto": True},
    {"key": "Numbers: on slide 3", "tests": ['test_table_numbers', 'test_gap_p4_numbers'], "auto": True},
    {"key": "Paste from Excel: in Excel select", "tests": ["test_paste_from_excel"], "auto": False,
     "left": "copying from the real Excel: " + OFFICE},
    {"key": "Insert > Table: move the mouse", "tests": ['test_insert_and_resize_table', 'test_gap_p4_insert_table'], "auto": True},
    {"key": "Capture Excel fixtures", "tests": [], "auto": False,
     "left": "tests/fixtures/clipboard/excel-comps.js is already a real capture (2026-11-04); "
             "PowerPoint/Word table captures optional"},
    # ---- Phase 5 -----------------------------------------------------
    {"key": "Pictures: Insert > Pictures", "tests": ["test_insert_picture", "test_gap_p5_pictures"], "auto": True},
    {"key": "Drop and paste", "tests": ["test_paste_and_drop_pictures"], "auto": False,
     "left": "drag from Explorer, Win+Shift+S, Excel chart copy: real Windows gestures"},
    {"key": "Picture Format", "tests": ['test_picture_format', 'test_gap_p5_picture_format'], "auto": True},
    {"key": "Crop: select a picture", "tests": ["test_crop_picture", "test_gap_p5_crop"], "auto": True},
    {"key": "Shapes: Insert > Shapes", "tests": ['test_insert_shapes', 'test_gap_p5_shapes'], "auto": True},
    {"key": "Shape Format", "tests": ['test_shape_format', 'test_gap_p5_shape_format'], "auto": True},
    {"key": "Text in shapes", "tests": ['test_shape_text', 'test_gap_p5_text_in_shapes'], "auto": True},
    {"key": "Shape handles", "tests": ['test_line_and_adjust_handles', 'test_gap_p5_shape_handles'], "auto": True},
    # ---- Phase 6 -----------------------------------------------------
    {"key": "Charts drawn", "tests": ['test_chart_rendering', 'test_gap_p6_charts_drawn'], "auto": True},
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
    {"key": "Slides: Home > New Slide", "tests": ['test_add_duplicate_delete_slides', 'test_gap_p7b_new_slide'], "auto": True},
    {"key": "Reorder and hide", "tests": ['test_reorder_and_hide_slides', 'test_saved_deck_presents_on_its_own', 'test_gap_p7b_reorder_hide'], "auto": True},
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
    # ---- Phase 8 -----------------------------------------------------
    {"key": "Slide show: open samples/contract-deck.html", "tests": ["test_slideshow"], "auto": False,
     "left": "Esc in real full screen is taken by Edge itself (it leaves full screen; the show ends on that): "
             "the test's Esc reaches the page instead"},
    {"key": "Presenter view: on slide 1 press Alt+F5", "tests": ["test_presenter_view"], "auto": False,
     "left": "the show full screen beside the presenter window (headless browsers leave that request pending; checked once "
             "by hand in headed Edge 157); moving the window to a second screen"},
    {"key": "PDF: on slide 3 press Ctrl+P", "tests": ["test_pdf_export"], "auto": False,
     "left": "Edge's real print window and its Save as PDF (the test keeps the printed document and prints it itself)"},
    {"key": "Pictures: Export > PNG of This Slide", "tests": ["test_slide_pictures"], "auto": False,
     "left": "pasting into Outlook and Teams: " + OFFICE},
    {"key": "Pictures ZIP: open samples/contract-deck.html", "tests": ["test_slide_pictures_zip"], "auto": True},
    {"key": "PowerPoint: open samples/contract-deck.html, Export > PowerPoint", "tests": ["test_pptx_export_text", "test_pptx_export_table", "test_pptx_export_charts"], "auto": False,
     "left": "opening the file in PowerPoint and editing there (the tests read the file's XML; PowerPoint 16 was checked by hand through COM)"},
    {"key": "Clean copy: open samples/contract-deck.html", "tests": ["test_save_clean_copy"], "auto": False,
     "left": "the real Save window and its suggested name (the test uses the download fallback); moving a box by hand"},
    # ---- Phase 9 -----------------------------------------------------
    {"key": "Comments: open samples/contract-deck.html, click the subtitle", "auto": False,
     "tests": ["test_comments_pane", "test_comment_markers_and_anchors", "test_comments_saved_but_never_shown_or_sent"],
     "left": "not yet audited clause by clause (closing the file and opening it again from disk is a re-open of a download)"},
    {"key": "Delete all: in a deck with comments on two slides", "auto": False,
     "tests": ["test_delete_all_comments", "test_comments_saved_but_never_shown_or_sent"],
     "left": "Ctrl+U (page source) of the clean copy is read as its file text; Edge's print window is imitated"},
    {"key": "Shortcuts: with a deck open press ?", "auto": False, "tests": ["test_shortcut_cheat_sheet"],
     "left": "the filter word here is 'comment', not 'bold' (needs a replay of the exact line)"},
    {"key": "About: Help > About / Licenses", "auto": False, "tests": ["test_about_and_licenses"],
     "left": "not yet audited clause by clause"},
]
