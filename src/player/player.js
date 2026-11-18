/*
 * Deck player - added by the Deck Editor when it saves a deck (SPEC 3.6).
 * It lets the saved file present on its own in any browser, with no editor.
 *
 * Keys: Right / Down / PageDown / Space = next, Left / Up / PageUp = previous,
 * Home / End = first / last, F = full screen. Hidden slides are skipped.
 *
 * Inside the editor this script never runs: the editor shows decks in a
 * sandboxed iframe without "allow-scripts", and removes it on open.
 */
(function () {
    'use strict';

    var WIDTH = 1280;
    var HEIGHT = 720;
    var root = document.documentElement;
    var slides = Array.prototype.slice.call(document.querySelectorAll('section.slide')).filter(function (slide) {
        return slide.getAttribute('data-hidden') !== 'true';
    });
    if (slides.length === 0) {
        return;
    }

    var index = 0;
    var counter = document.createElement('div');
    counter.className = 'deck-player-counter';
    counter.setAttribute('aria-live', 'polite');
    document.body.appendChild(counter);
    root.classList.add('deck-player-on');

    function fit() {
        var scale = Math.min(window.innerWidth / WIDTH, window.innerHeight / HEIGHT);
        root.style.setProperty('--deck-player-scale', String(scale));
    }

    function show(newIndex) {
        index = Math.max(0, Math.min(slides.length - 1, newIndex));
        slides.forEach(function (slide, i) {
            slide.classList.toggle('deck-player-current', i === index);
        });
        counter.textContent = (index + 1) + ' / ' + slides.length;
    }

    function toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else if (root.requestFullscreen) {
            root.requestFullscreen().catch(function () { /* refused by the browser: ignore */ });
        }
    }

    document.addEventListener('keydown', function (event) {
        if (event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }
        var key = event.key;
        if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || (key === ' ' && !event.shiftKey)) {
            show(index + 1);
        } else if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp' || (key === ' ' && event.shiftKey)) {
            show(index - 1);
        } else if (key === 'Home') {
            show(0);
        } else if (key === 'End') {
            show(slides.length - 1);
        } else if (key === 'f' || key === 'F') {
            toggleFullscreen();
        } else {
            return;
        }
        event.preventDefault();
    });

    // Links (Deck Editor Phase 10): #slide-<id> shows that slide; a web page or e-mail opens in a new window.
    Array.prototype.forEach.call(document.querySelectorAll('a[href^="http"], a[href^="mailto:"]'), function (link) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener');
    });
    document.addEventListener('click', function (event) {
        var link = event.target && event.target.closest && event.target.closest('a[href^="#slide-"]');
        if (!link) {
            return;
        }
        event.preventDefault();
        var id = link.getAttribute('href').slice(7);
        for (var i = 0; i < slides.length; i++) {
            if (slides[i].getAttribute('data-slide-id') === id) {
                show(i);
                return;
            }
        }
    });

    window.addEventListener('resize', fit);
    fit();
    show(0);
})();
