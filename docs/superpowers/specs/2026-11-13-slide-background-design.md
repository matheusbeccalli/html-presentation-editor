# Slide background colour, per slide (design)

Date: 2026-11-13. Size: a small change (one control, one module).

## Intent

Give one slide its own solid background colour (a dark section divider, a coloured title slide) without
touching the others, like PowerPoint's Format Background. Every slide at once stays the theme's job:
Apply to All is a shortcut to the theme, not a copy on each slide.

## Goals

- Design tab > new **Background** group > **Slide Background** colour button (split button, the text
  colour menu: theme colours, standard colours, More colors…), plus two menu items:
  - **Reset to Theme**: the slide drops its own colour and follows the theme's Background again.
  - **Apply to All**: the colour becomes the theme's Background (`--color-bg`) and every slide's own
    background is cleared, so the whole deck follows the theme, slides added later too.
- The same menu from a right-click on an empty part of the slide and on a thumbnail in the slide rail.
- Picking a theme colour keeps the link (`var(--color-accent)`), so Edit Theme changes follow, as text colour does.
- One undo step each (one slide: slide scope; Apply to All: deck scope).
- Saved in the file; slideshow, print/PDF, thumbnails and PowerPoint export show it.

## Non-goals

- Pictures and gradients as backgrounds (solid colour only, as decided).
- Recolouring text for contrast.
- Several slides at once from the rail (the rail has no multi-select today).

## Anti-goals

- A slide whose colour cannot be taken back to the theme.
- A deck where Edit Theme > Background silently does nothing (today's state of imported decks); Reset to
  Theme and Apply to All are the way out.

## Approaches (for Apply to All)

- **A. Set the theme's Background, clear every slide's own colour** (chosen): "every slide" always means the
  theme, so new slides match and Edit Theme keeps working. Wipes special colours on other slides, as
  PowerPoint's Apply to All does.
- B. Copy the colour onto each slide: new slides come in different, Edit Theme Background stops working.
- C. Like A but keep slides with their own colour: looks broken when some slides don't change.

## Decided

- Solid colour only.
- A slide's own colour is stored inline on its section: `<section class="slide" style="background-color: …;
  background-image: none">` (the form normalize.js already writes for imported decks, which pptx.js:741
  already exports). "Own colour" = an inline background on the section; Reset to Theme removes the inline
  background properties.
- Choosing a colour on a slide with an imported gradient or picture replaces it.
- Apply to All with a theme colour (say Accent) writes that colour's hex into `--color-bg` through
  App.theme.write (a theme value is a plain colour, as the theme editor expects).

## Left to the builder

- Module placement (a small `background.js`, or inside slides.js), the button's icon, the colour shown on the
  split button (the current slide's colour).
- How the right-click item opens the colour menu (anchored where the menu was).
- Tests: unit (set / reset / apply to all on a fixture deck, theme-var link kept), e2e (ribbon, rail
  right-click, undo, save-reopen, PPTX background), FEATURES.md line under Phase 9 + hand check + tests/edge entry.
