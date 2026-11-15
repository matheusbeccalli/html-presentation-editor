/*
 * background.js - a slide's own background colour (Design > Slide Background).
 *
 * Approach: a slide that follows the theme has no background of its own and
 * is painted by the deck's CSS with the theme's Background (var(--color-bg)).
 * A slide's own colour is written on its <section class="slide"> inline:
 * "background-color: …; background-image: none" (the form normalize.js
 * already writes for imported decks, and what pptx.js exports). A theme colour
 * is kept as var(--color-…), so it follows later theme changes.
 *
 * Reset to Theme and Apply to All must leave the slide in the theme's
 * Background even when the deck's own CSS paints its slides some other way (a
 * Copilot deck's gradient): then one small rule, <style data-deck-background>,
 * paints every slide with var(--color-bg), and a slide that still does not
 * follow (a deck rule stronger than ours) gets var(--color-bg) inline.
 *
 * Apply to All goes through the theme: the colour becomes --color-bg and every
 * slide's own colour is cleared, so slides added later match too.
 *
 * Talks to: history.js (one undo step each), deck.js (the slide shown),
 *           theme.js (applyValues, hexOf), textcontrols.js (the colour button).
 */

(function () {
    'use strict';

    App.background = {};

    const PROPERTIES = ['background', 'background-color', 'background-image', 'background-size', 'background-position',
        'background-repeat', 'background-attachment', 'background-origin', 'background-clip'];
    const THEME_VALUE = 'var(--color-bg)';
    const THEME_RE = /^var\(\s*--color-bg\s*\)$/;
    // Stronger than the deck's own ".slide" or ".slide.light" rules; an inline colour still wins over it.
    const THEME_RULE = ':root body section.slide { background-color: var(--color-bg); background-image: none; }\n';

    /* The slide's own colour as written ('var(--color-accent)', 'rgb(…)'), or null when it follows the theme. */
    App.background.ownColor = function ownColor(slide) {
        const color = slide.style.backgroundColor.trim();
        if (!color) {
            const image = slide.style.backgroundImage;
            return image && image !== 'none' ? 'transparent' : null;   // an imported picture or gradient only
        }
        return THEME_RE.test(color) ? null : color;
    };

    /* Every background property off the slide's inline style (the attribute goes when nothing is left). */
    App.background.clearOwn = function clearOwn(slide) {
        PROPERTIES.forEach((name) => slide.style.removeProperty(name));
        if (!slide.getAttribute('style') || !slide.getAttribute('style').trim()) {
            slide.removeAttribute('style');
        }
    };

    /* `value` as the slide's own colour; an imported picture or gradient goes. */
    App.background.writeOwn = function writeOwn(slide, value) {
        App.background.clearOwn(slide);
        slide.style.setProperty('background-color', value);
        slide.style.setProperty('background-image', 'none');
    };

    // ---------------------------------------------------------------
    // Following the theme (needs the deck's computed styles)
    // ---------------------------------------------------------------

    function isDeclared(doc) {
        return doc.defaultView.getComputedStyle(doc.documentElement).getPropertyValue('--color-bg').trim() !== '';
    }

    /* The theme's Background as the browser paints it. */
    function themeColor(doc) {
        const probe = doc.createElement('div');
        probe.setAttribute('data-editor-only', '');
        probe.style.backgroundColor = THEME_VALUE;
        doc.body.appendChild(probe);
        const color = doc.defaultView.getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
    }

    function paintsTheme(slide, color) {
        const computed = slide.ownerDocument.defaultView.getComputedStyle(slide);
        return computed.backgroundImage === 'none' && computed.backgroundColor === color;
    }

    /* Does the deck's CSS paint a slide with no background of its own in the theme's Background? */
    App.background.followsThemeByCss = function followsThemeByCss(doc) {
        const probe = doc.createElement('section');
        probe.setAttribute('class', 'slide');
        probe.setAttribute('data-editor-only', '');
        doc.body.appendChild(probe);
        const follows = paintsTheme(probe, themeColor(doc));
        probe.remove();
        return follows;
    };

    /* Does making slides follow the theme change the deck's <head> (so the undo step must cover the whole deck)? */
    function needsHeadChange(doc) {
        return !isDeclared(doc) || !App.background.followsThemeByCss(doc);
    }

    /*
     * The colour a deck with no theme Background starts with, read from `slide`
     * as it is now: its plain colour (under a picture or gradient), or the
     * page's behind it (a Copilot deck's navy under its white text); white only
     * when there is none. Not white at once: white text would disappear.
     */
    function startingColor(slide) {
        const view = slide.ownerDocument.defaultView;
        for (let node = slide; node; node = node.parentElement) {
            const color = view.getComputedStyle(node).backgroundColor;
            if (!/^transparent$|^rgba\(.*,\s*0\s*\)$/.test(color)) {
                return App.theme.toHex(color) || '#ffffff';
            }
        }
        return '#ffffff';
    }

    /* The theme's Background declared (from `slide`, see startingColor) and our rule added when the deck's CSS needs it. */
    App.background.ensureThemeRule = function ensureThemeRule(doc, slide) {
        if (!isDeclared(doc)) {
            App.theme.applyValues(doc, { '--color-bg': slide ? startingColor(slide) : '#ffffff' });
        }
        if (doc.head.querySelector('style[data-deck-background]') || App.background.followsThemeByCss(doc)) {
            return;
        }
        const style = doc.createElement('style');
        style.setAttribute('data-deck-background', '');
        style.textContent = THEME_RULE;
        doc.head.insertBefore(style, doc.head.querySelector(App.theme.EDITOR_STYLES));
    };

    /* `slide` back to the theme's Background (inside an undo step). */
    function followTheme(slide) {
        const doc = slide.ownerDocument;
        App.background.ensureThemeRule(doc, slide);   // before its own colour goes: the theme may start from it
        App.background.clearOwn(slide);
        if (!paintsTheme(slide, themeColor(doc))) {
            App.background.writeOwn(slide, THEME_VALUE);   // a deck rule stronger than ours
        }
    }

    // ---------------------------------------------------------------
    // The actions (one undo step each)
    // ---------------------------------------------------------------

    App.background.canEdit = function canEdit() {
        return !!App.state.hasDeck && !!App.deck.getCurrentSlide();
    };

    /* The slide shown gets `value` (a colour or var(--color-…)) as its own. */
    App.background.setColor = function setColor(value) {
        const slide = App.deck.getCurrentSlide();
        if (!slide) {
            return;
        }
        App.history.change('Slide background', { slideId: slide.getAttribute('data-slide-id') },
            () => App.background.writeOwn(slide, value));
    };

    /* Reset to Theme: the slide shown follows the theme's Background again. */
    App.background.reset = function reset() {
        const slide = App.deck.getCurrentSlide();
        if (!slide) {
            return;
        }
        const scope = needsHeadChange(slide.ownerDocument) ? 'deck' : { slideId: slide.getAttribute('data-slide-id') };
        App.history.change('Reset slide background', scope, () => followTheme(slide));
    };

    /* Apply to All: `value` becomes the theme's Background and every slide follows it. */
    App.background.applyToAll = function applyToAll(value) {
        const doc = App.deck.getDocument();
        if (!doc) {
            return;
        }
        const hex = App.theme.hexOf(doc, value);
        App.history.change('Background to all slides', 'deck', () => {
            App.theme.applyValues(doc, { '--color-bg': hex });
            doc.querySelectorAll('section.slide').forEach(followTheme);
            App.text.forgetTheme(doc);
        });
    };
})();
