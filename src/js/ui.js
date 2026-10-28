/*
 * ui.js - the window frame around the slide: title bar, status bar, notes
 * area, welcome screen, drop zone and the "busy" overlay.
 *
 * It mostly listens to events and updates text; it never changes the deck.
 *
 * Talks to: events (deck-loaded, slide-changed, history-changed, saved,
 *           zoom-changed), deck.js, fileio.js (window title), commands.js.
 */

(function () {
    'use strict';

    App.ui = {};

    const nodes = {};

    function byId(id) {
        return document.getElementById(id);
    }

    App.ui.init = function init() {
        ['title-file', 'title-dirty', 'status-slide', 'status-message', 'status-zoom', 'notes-text',
         'welcome', 'canvas-stage-box', 'drop-zone', 'busy', 'busy-text', 'quick-access'].forEach((id) => {
            nodes[id] = byId(id);
        });

        buildQuickAccess();
        byId('welcome-new').addEventListener('click', () => App.commands.run('newDeck'));
        byId('welcome-open').addEventListener('click', () => App.commands.run('open'));

        App.events.on('deck-loaded', () => {
            App.ui.updateTitle();
            updateSlideInfo();
        });
        App.events.on('slide-changed', updateSlideInfo);
        App.events.on('history-changed', () => {
            App.ui.updateTitle();
            updateSlideInfo();
        });
        App.events.on('saved', App.ui.updateTitle);
        App.events.on('zoom-changed', (info) => {
            nodes['status-zoom'].textContent = App.state.hasDeck ? Math.round(info.zoom * 100) + '%' : '';
        });
    };

    // Save / Undo / Redo in the title bar, like PowerPoint's Quick Access Toolbar.
    function buildQuickAccess() {
        [['save', 'save', 'Save (Ctrl+S)'], ['undo', 'undo', 'Undo (Ctrl+Z)'], ['redo', 'redo', 'Redo (Ctrl+Y)']]
            .forEach(([command, icon, title]) => {
                const button = App.util.el('button', {
                    type: 'button', class: 'quick-button', title: title, 'data-command': command,
                    onclick: () => App.commands.run(command),
                });
                button.innerHTML = App.icons.get(icon);
                nodes['quick-access'].appendChild(button);
            });
        const refresh = () => {
            nodes['quick-access'].querySelectorAll('button').forEach((button) => {
                button.disabled = !App.commands.isEnabled(button.getAttribute('data-command'));
            });
        };
        ['deck-loaded', 'history-changed', 'saved'].forEach((name) => App.events.on(name, refresh));
        App.ui.refreshQuickAccess = refresh;
    }

    App.ui.updateTitle = function updateTitle() {
        const dirty = App.state.hasDeck && App.history.isDirty();
        document.title = App.fileio.windowTitle(App.state.hasDeck ? App.state.fileName : null, dirty);
        nodes['title-file'].textContent = App.state.hasDeck ? App.state.fileName : 'Deck Editor';
        nodes['title-dirty'].hidden = !dirty;
        if (App.state.hasDeck && !dirty && nodes['status-message'].textContent === 'Unsaved changes') {
            App.ui.setStatus('Saved');
        } else if (dirty) {
            App.ui.setStatus('Unsaved changes');
        }
    };

    function updateSlideInfo() {
        const slides = App.deck.getSlides();
        const index = App.deck.getCurrentIndex();
        const slide = slides[index];
        const hidden = slide && slide.getAttribute('data-hidden') === 'true';
        nodes['status-slide'].textContent = slides.length
            ? 'Slide ' + (index + 1) + ' of ' + slides.length + (hidden ? ' (hidden)' : '')
            : '';
        const notes = App.deck.notesOf(slide);
        nodes['notes-text'].textContent = notes || 'No speaker notes on this slide.';
        nodes['notes-text'].classList.toggle('empty', !notes);
    }

    App.ui.setStatus = function setStatus(text) {
        nodes['status-message'].textContent = text;
    };

    App.ui.showWelcome = function showWelcome() {
        nodes.welcome.hidden = false;
        nodes['canvas-stage-box'].hidden = true;
        App.ribbon.showDefaultTab();
        App.ui.refreshQuickAccess();
        App.ui.updateTitle();
    };

    App.ui.showDeck = function showDeck() {
        nodes.welcome.hidden = true;
        nodes['canvas-stage-box'].hidden = false;
        App.canvas.fit();
        App.ui.updateTitle();
        App.ribbon.refresh();
        App.ui.refreshQuickAccess();
    };

    App.ui.showDropZone = function showDropZone(visible) {
        nodes['drop-zone'].hidden = !visible;
    };

    /* Show a "please wait" layer with a message; pass null to hide it. */
    App.ui.setBusy = function setBusy(text) {
        nodes.busy.hidden = !text;
        nodes['busy-text'].textContent = text || '';
    };
})();
