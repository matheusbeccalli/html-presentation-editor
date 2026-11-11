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
    {"key": "Home > Paragraph, alignment and spacing", "tests": ["test_paragraph_formatting"], "auto": False,
     "left": "Ctrl+R reload (and its unsaved-changes prompt); Ctrl+Z step by step"},
    {"key": "Paste: copy a 3-level bulleted list in Word", "tests": ["test_paste_into_text", "test_paste_options_button"],
     "auto": False, "left": "real Word/Outlook/Copilot/web copies: " + OFFICE},
    {"key": "Copy: select two bullets", "tests": ["test_copy_and_cut_text"], "auto": False,
     "left": "pasting into a new Outlook e-mail: " + OFFICE},
    {"key": "Format painter", "tests": ["test_format_painter"], "auto": False, "left": "double-click painter on three words (test does two); typing after Esc"},
    {"key": "Find & replace", "tests": ["test_find_and_replace"], "auto": False, "left": "Ctrl+Z inside the panel's boxes; Ctrl+H never opens Edge History; the yellow/orange colours (counted, not seen)"},
    {"key": "Autofit", "tests": ["test_autofit"], "auto": False, "left": "dragging the box taller (test uses the Height field); save and open the saved file on its own"},
    # ---- Phase 4 -----------------------------------------------------
    {"key": "The whole journey in Edge, timed", "tests": ["test_phase4_done_when"], "auto": False,
     "left": "copying from Excel and the one-minute timing: " + OFFICE},
    {"key": "In Edge: open a deck saved before Phase 4", "tests": ["test_format1_deck_text_is_converted"],
     "auto": False, "left": "the table 'looks as before' (header colour, right-aligned numbers, bold Mediana row with its line)"},
    {"key": "Typing in cells", "tests": ["test_table_cell_editing"], "auto": True},
    {"key": "Layout tab", "tests": ["test_table_layout"], "auto": True},
    {"key": "Column borders", "tests": ["test_table_column_borders"], "auto": False, "left": "the EV/EBITDA | Margem border (test drags EV | EV/EBITDA)"},
    {"key": "Table Design", "tests": ["test_table_design"], "auto": False, "left": "Insert > Table via the ribbon; Table Design next to Layout; Banded Rows untick, First Column, pen colour, No Border; the Ctrl+Z steps; save and reopen"},
    {"key": "Numbers: on slide 3", "tests": ["test_table_numbers"], "auto": False, "left": "Ctrl+Z after Increase Decimal; closing and reopening the editor; Tab, abc, Esc back on the left; the last Ctrl+Z"},
    {"key": "Paste from Excel: in Excel select", "tests": ["test_paste_from_excel"], "auto": False,
     "left": "copying from the real Excel: " + OFFICE},
    {"key": "Insert > Table: move the mouse", "tests": ["test_insert_and_resize_table"], "auto": False,
     "left": "dark header and grey bands as colours; the 2 x 2 table after reopen"},
    {"key": "Capture Excel fixtures", "tests": [], "auto": False,
     "left": "tests/fixtures/clipboard/excel-comps.js is already a real capture (2026-11-04); "
             "PowerPoint/Word table captures optional"},
    # ---- Phase 5 -----------------------------------------------------
    {"key": "Pictures: Insert > Pictures", "tests": ["test_insert_picture"], "auto": False, "left": "Ctrl+click of two files in the real dialog; where they land; one Ctrl+Z removes both; status bar growing; file size in Explorer"},
    {"key": "Drop and paste", "tests": ["test_paste_and_drop_pictures"], "auto": False,
     "left": "drag from Explorer, Win+Shift+S, Excel chart copy: real Windows gestures"},
    {"key": "Picture Format", "tests": ["test_picture_format"], "auto": True},
    {"key": "Crop: select a picture", "tests": ["test_crop_picture"], "auto": False, "left": "black handles and the dimmed part (seen); file size compared after Save"},
    {"key": "Shapes: Insert > Shapes", "tests": ["test_insert_shapes"], "auto": False, "left": "one Ctrl+Z removes the chevron"},
    {"key": "Shape Format", "tests": ["test_shape_format"], "auto": False, "left": "Ctrl+Z after each of the six changes (test undoes two)"},
    {"key": "Text in shapes", "tests": ["test_shape_text"], "auto": False, "left": "bullets and font colour inside a shape"},
    {"key": "Shape handles", "tests": ["test_line_and_adjust_handles"], "auto": False, "left": "rounded rectangle's yellow handle; round end handles; Shift snap at 45 degrees"},
    # ---- Phase 6 -----------------------------------------------------
    {"key": "Charts drawn", "tests": ["test_chart_rendering"], "auto": False, "left": "look: 2025E lighter and dashed, 1.234 on top, legend at the bottom, horizontal bars"},
    {"key": "Lines, combo, donut", "tests": ["test_chart_lines_combo_donut"], "auto": False, "left": "look: combo numbers in the base, red margin line dashed into 2025E, donut 55/30/15% with legend on the right"},
    {"key": "Waterfall: open", "tests": ["test_chart_waterfall"], "auto": False, "left": "look: colours, the red bar hanging down, thin connectors"},
    {"key": "More types", "tests": ["test_chart_types_priority_2"], "auto": False, "left": "look: 100% stacking and 60/40 labels, 2025E lighter, bubble names/axes/sizes"},
    {"key": "Readability", "tests": ["test_chart_readability"], "auto": False, "left": "look: CAGR pill on its arrow, source under the chart, names left of the bars, all 24 months turned"},
    {"key": "Insert a chart", "tests": ["test_insert_chart_and_design"], "auto": False, "left": "Ctrl+Z after inserting; CAGR placed over the columns"},
    {"key": "Data grid", "tests": ["test_chart_data_grid"], "auto": False,
     "left": "waterfall roles Start / Change / End (test sets only Subtotal); the column growing while you type"},
    {"key": "Paste from Excel: in Excel (a sheet", "tests": ["test_chart_paste_from_excel"], "auto": False,
     "left": "copying from the real Excel: " + OFFICE},
    {"key": "Label numbers", "tests": ["test_chart_label_numbers"], "auto": False, "left": "a chart actually showing (50); Ctrl+Z one change at a time"},
    # ---- Phase 7 -----------------------------------------------------
    {"key": "Speaker notes", "tests": ["test_speaker_notes"], "auto": True},
    {"key": "Slides: Home > New Slide", "tests": ["test_add_duplicate_delete_slides"], "auto": False,
     "left": "Title and Content and the other two layouts from the gallery; Ctrl+Z after Ctrl+M and after Duplicate"},
    {"key": "Reorder and hide", "tests": ["test_reorder_and_hide_slides", "test_saved_deck_presents_on_its_own"],
     "auto": True},
    {"key": "Multi-select", "tests": ["test_multi_select"], "auto": False, "left": "the Delete key after Ctrl+A; dragging the Shift+click pair"},
    {"key": "Align and distribute", "tests": ["test_align_and_distribute"], "auto": False, "left": "Align left that actually moves boxes; Align to slide + Align middle with three; picking three with Shift+click"},
    {"key": "Smart guides", "tests": ["test_smart_guides_gridlines_and_rulers"], "auto": False,
     "left": "red line on the box-to-box snap; close and reopen the editor: ruler still on"},
    {"key": "Group:", "tests": ["test_group_and_ungroup"], "auto": False, "left": "Format pane says Group; dragging the group with the mouse; Ctrl+Z after Ctrl+G and after typing"},
    {"key": "Rotate:", "tests": ["test_rotate", "test_gap_rotate"], "auto": True},
    {"key": "Lock:", "tests": ["test_lock", "test_gap_lock"], "auto": True},
    {"key": "Slide master: View > Slide Master", "tests": ["test_slide_master"], "auto": False,
     "left": "Ctrl+P on the saved file; footer (not just numbers) when presenting; every slide (test checks two)"},
    {"key": "Slide master on a Copilot deck", "tests": ["test_slide_master_own_footers"], "auto": False,
     "left": "a real Copilot deck (test uses a made-up copy of the contract deck)"},
    {"key": "Theme: Design > Edit Theme", "tests": ["test_theme_editor", "test_phase7_done_when"], "auto": False,
     "left": "the thumbnails following the new theme (not checked); a deck you saved yourself (tests use made-up ones)"},
]
