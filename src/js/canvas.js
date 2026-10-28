/*
 * canvas.js - the slide area in the centre, with "fit to window" zoom (SPEC 4, Phase 1).
 *
 * The deck iframe is always exactly 1280x720 (the real slide size), so every
 * measurement inside it is in true slide pixels. To make it fit the window we
 * scale its container with a CSS transform instead of resizing it.
 *
 * The overlay layer (#overlay) sits on top of the iframe inside the same
 * scaled container. Phase 2 draws selection handles there, never in the slide.
 *
 * Talks to: deck.js (the iframe it sizes), ui.js (shows the zoom level).
 */

(function () {
    'use strict';

    App.canvas = {};

    const SLIDE_WIDTH = 1280;
    const SLIDE_HEIGHT = 720;
    const MARGIN = 32;   // free space around the slide, in screen pixels

    let area = null;
    let stage = null;
    let stageBox = null;
    let zoom = 1;

    App.canvas.init = function init() {
        area = document.getElementById('canvas-area');
        stage = document.getElementById('canvas-stage');
        stageBox = document.getElementById('canvas-stage-box');
        // ResizeObserver calls fit() whenever the area changes size (window
        // resized, a panel opened ...), not only when the window resizes.
        new ResizeObserver(() => App.canvas.fit()).observe(area);
    };

    App.canvas.fit = function fit() {
        const availableWidth = area.clientWidth - MARGIN * 2;
        const availableHeight = area.clientHeight - MARGIN * 2;
        if (availableWidth <= 0 || availableHeight <= 0) {
            return;
        }
        zoom = Math.min(availableWidth / SLIDE_WIDTH, availableHeight / SLIDE_HEIGHT);
        stage.style.transform = 'scale(' + zoom + ')';
        stageBox.style.width = Math.floor(SLIDE_WIDTH * zoom) + 'px';
        stageBox.style.height = Math.floor(SLIDE_HEIGHT * zoom) + 'px';
        App.events.emit('zoom-changed', { zoom: zoom });
    };

    App.canvas.getZoom = function getZoom() {
        return zoom;
    };
})();
