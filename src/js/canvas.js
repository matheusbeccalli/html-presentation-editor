/*
 * canvas.js - the slide area in the centre and its zoom (SPEC 4, Phases 1-2).
 *
 * The deck iframe is always exactly 1280x720 (the real slide size), so every
 * measurement inside it is in true slide pixels. To zoom, we scale its
 * container with a CSS transform instead of resizing it.
 *
 * Two modes:
 *   fit     the slide fills the window and follows its size (the default)
 *   manual  a fixed zoom from 50% to 400% (Ctrl+mouse wheel, the slider and
 *           the +/- buttons in the status bar); the slide area scrolls.
 * Ctrl+wheel zooms around the mouse, so the point under it stays put.
 *
 * The overlay layer (#overlay) sits on top of the iframe inside the same
 * scaled container; selection.js draws the handles there.
 *
 * Talks to: deck.js (the iframe it sizes), selection.js (via 'zoom-changed').
 */

(function () {
    'use strict';

    App.canvas = {};

    const SLIDE_WIDTH = 1280;
    const SLIDE_HEIGHT = 720;
    const MARGIN = 32;          // free space around the slide, in screen pixels
    const MIN_ZOOM = 0.5;
    const MAX_ZOOM = 4;
    const STEP = 1.1;           // one wheel notch or +/- click: 10%

    // ---------------------------------------------------------------
    // Pure helpers (tested in tests/unit/canvas.test.js)
    // ---------------------------------------------------------------

    App.canvas.clampZoom = function clampZoom(value) {
        return App.util.round2(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value)));
    };

    /* The zoom after one wheel notch; deltaY < 0 means "wheel up" = zoom in. */
    App.canvas.wheelZoom = function wheelZoom(current, deltaY) {
        return App.canvas.clampZoom(deltaY < 0 ? current * STEP : current / STEP);
    };

    /* The zoom that shows the whole slide in an area of this size, or null if it is too small. */
    App.canvas.fitZoom = function fitZoom(areaWidth, areaHeight) {
        const availableWidth = areaWidth - MARGIN * 2;
        const availableHeight = areaHeight - MARGIN * 2;
        if (availableWidth <= 0 || availableHeight <= 0) {
            return null;
        }
        return Math.min(availableWidth / SLIDE_WIDTH, availableHeight / SLIDE_HEIGHT);
    };

    // ---------------------------------------------------------------
    // State and page
    // ---------------------------------------------------------------

    let area = null;
    let stage = null;
    let stageBox = null;
    let zoom = 1;
    let fitMode = true;
    const controls = {};

    App.canvas.init = function init() {
        area = document.getElementById('canvas-area');
        stage = document.getElementById('canvas-stage');
        stageBox = document.getElementById('canvas-stage-box');
        ['zoom-controls', 'zoom-slider', 'zoom-percent', 'zoom-in', 'zoom-out', 'zoom-fit'].forEach((id) => {
            controls[id] = document.getElementById(id);
        });

        // ResizeObserver calls this whenever the area changes size (window
        // resized, a panel opened ...), not only when the window resizes.
        new ResizeObserver(() => {
            if (fitMode) {
                App.canvas.fit();
            }
        }).observe(area);

        // passive: false, because preventDefault() must stop the browser's own page zoom.
        area.addEventListener('wheel', (event) => {
            if (!event.ctrlKey || !App.state.hasDeck) {
                return;   // a plain wheel scrolls
            }
            event.preventDefault();
            App.canvas.setZoom(App.canvas.wheelZoom(zoom, event.deltaY), { x: event.clientX, y: event.clientY });
        }, { passive: false });

        controls['zoom-slider'].addEventListener('input', () => {
            App.canvas.setZoom(Number(controls['zoom-slider'].value) / 100);
        });
        controls['zoom-in'].addEventListener('click', () => App.canvas.setZoom(App.canvas.wheelZoom(zoom, -1)));
        controls['zoom-out'].addEventListener('click', () => App.canvas.setZoom(App.canvas.wheelZoom(zoom, 1)));
        controls['zoom-fit'].addEventListener('click', () => App.canvas.fit());
        App.events.on('deck-loaded', () => {
            controls['zoom-controls'].hidden = false;
        });
    };

    /* Scale the slide; keep the screen point `anchor` ({x, y}) over the same slide point. */
    function applyZoom(newZoom, anchor) {
        const areaRect = area.getBoundingClientRect();
        const point = anchor || { x: areaRect.left + area.clientWidth / 2, y: areaRect.top + area.clientHeight / 2 };
        const before = stageBox.getBoundingClientRect();
        const slideX = (point.x - before.left) / zoom;
        const slideY = (point.y - before.top) / zoom;

        zoom = newZoom;
        stage.style.transform = 'scale(' + zoom + ')';
        stageBox.style.width = Math.floor(SLIDE_WIDTH * zoom) + 'px';
        stageBox.style.height = Math.floor(SLIDE_HEIGHT * zoom) + 'px';

        // Reading the new position makes the browser lay out the page first.
        const after = stageBox.getBoundingClientRect();
        area.scrollLeft += after.left + slideX * zoom - point.x;
        area.scrollTop += after.top + slideY * zoom - point.y;

        showZoom();
        App.events.emit('zoom-changed', { zoom: zoom });
    }

    function showZoom() {
        const percent = Math.round(zoom * 100);
        controls['zoom-percent'].textContent = percent + '%';
        controls['zoom-slider'].value = String(percent);
        controls['zoom-fit'].classList.toggle('active', fitMode);
        controls['zoom-fit'].setAttribute('aria-pressed', fitMode ? 'true' : 'false');
    }

    /* Fit the whole slide in the window, and keep fitting when the window changes. */
    App.canvas.fit = function fit() {
        // offsetWidth/Height include any scrollbar left over from a manual zoom.
        const value = App.canvas.fitZoom(area.offsetWidth, area.offsetHeight);
        fitMode = true;
        if (value === null) {
            return;
        }
        applyZoom(value, null);
    };

    /* Manual zoom (50%-400%). anchor: optional screen point {x, y} that stays put. */
    App.canvas.setZoom = function setZoom(value, anchor) {
        fitMode = false;
        applyZoom(App.canvas.clampZoom(value), anchor || null);
    };

    App.canvas.getZoom = function getZoom() {
        return zoom;
    };

    App.canvas.isFit = function isFit() {
        return fitMode;
    };

    /* Scroll so that a slide rectangle {left, top, width, height} is in the middle of the view. */
    App.canvas.scrollIntoView = function scrollIntoView(rect) {
        const box = stageBox.getBoundingClientRect();
        const areaRect = area.getBoundingClientRect();
        const centerX = box.left + (rect.left + rect.width / 2) * zoom;
        const centerY = box.top + (rect.top + rect.height / 2) * zoom;
        area.scrollLeft += centerX - (areaRect.left + area.clientWidth / 2);
        area.scrollTop += centerY - (areaRect.top + area.clientHeight / 2);
    };
})();
