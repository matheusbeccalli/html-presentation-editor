/*
 * autosave.js - AutoSave to the deck file, like PowerPoint's (SPEC 6.1, layer 1).
 *
 * The AutoSave switch in the title bar turns on by itself after the user's
 * first manual save of the session into a real file (never for a download),
 * so the original file is never overwritten before the user chose to save.
 *
 * When to write (the "scheduler", tested with a fake clock):
 *   - 5 seconds after the last change,
 *   - but at least every 30 seconds while the user keeps editing,
 *   - never during a drag/resize or while an IME is composing a character
 *     (it retries a second later),
 *   - never two writes at once.
 *
 * Before each write fileio.autoSave() checks that the file did not change on
 * disk. If it did, AutoSave pauses and asks: Reload / Save as copy / Overwrite.
 *
 * Talks to: fileio.js (writes), history.js (dirty state, drags in progress),
 *           dialogs.js, ui.js (status), events (history-changed, saved, deck-loaded).
 */

(function () {
    'use strict';

    App.autosave = {};

    // ---------------------------------------------------------------
    // The scheduler (pure timing logic; tests/unit/autosave.test.js)
    // ---------------------------------------------------------------

    /*
     * options: { delay, maxWait, save, isBusy, retryMs, clock }
     *   save()   -> Promise; called when it is time to write
     *   isBusy() -> true while writing must wait (drag, IME)
     *   clock    -> { now, setTimeout, clearTimeout }; tests pass a fake one
     */
    App.autosave.createScheduler = function createScheduler(options) {
        const clock = options.clock || {
            now: () => Date.now(),
            setTimeout: (fn, ms) => setTimeout(fn, ms),
            clearTimeout: (id) => clearTimeout(id),
        };
        const retryMs = options.retryMs || 1000;
        const isBusy = options.isBusy || (() => false);

        let timer = null;
        let firstChangeAt = null;   // start of the current run of edits (for the 30 s limit)
        let saving = false;
        let changedWhileSaving = false;

        function schedule(at) {
            clock.clearTimeout(timer);
            timer = clock.setTimeout(fire, Math.max(0, at - clock.now()));
        }

        function notifyChange() {
            if (saving) {
                changedWhileSaving = true;   // picked up when the current write ends
                return;
            }
            const now = clock.now();
            if (firstChangeAt === null) {
                firstChangeAt = now;
            }
            schedule(Math.min(now + options.delay, firstChangeAt + options.maxWait));
        }

        async function fire() {
            timer = null;
            if (saving) {
                return;
            }
            if (isBusy()) {
                schedule(clock.now() + retryMs);
                return;
            }
            firstChangeAt = null;
            saving = true;
            try {
                await options.save();
            } catch (error) {
                console.error('AutoSave failed:', error);   // save() reports to the user itself
            } finally {
                saving = false;
            }
            if (changedWhileSaving) {
                changedWhileSaving = false;
                notifyChange();
            }
        }

        /* Write now if a write is waiting (e.g. the tab is closing). */
        function flush() {
            if (timer === null) {
                return Promise.resolve();
            }
            clock.clearTimeout(timer);
            return fire();
        }

        function cancel() {
            clock.clearTimeout(timer);
            timer = null;
            firstChangeAt = null;
            changedWhileSaving = false;
        }

        return { notifyChange: notifyChange, flush: flush, cancel: cancel, isScheduled: () => timer !== null };
    };

    // ---------------------------------------------------------------
    // AutoSave in the editor
    // ---------------------------------------------------------------

    const timing = { delay: 5000, maxWait: 30000 };
    let scheduler = null;
    let enabled = false;
    let userTurnedOff = false;     // the user switched it off: later manual saves do not switch it on
    let savedToFile = false;       // a manual save into a writable file happened this session
    let askingUser = false;        // the "changed on disk" question is open
    let composing = false;         // IME composition in progress
    let switchedOff = false;       // was on, then switched off or paused this session (status bar)
    let toggle = null;

    App.autosave.init = function init() {
        scheduler = makeScheduler();
        buildToggle();

        App.events.on('deck-loaded', () => {
            switchedOff = false;
            setEnabled(false);
            userTurnedOff = false;
            savedToFile = false;
            listenForComposition(App.deck.getDocument().defaultView);
            refreshToggle();
        });
        App.events.on('history-changed', (info) => {
            if (enabled && info.action !== 'saved' && info.action !== 'reset' && App.history.isDirty()) {
                scheduler.notifyChange();
            }
        });
        App.events.on('saved', (info) => {
            if (info.auto || !info.toHandle) {
                return;
            }
            savedToFile = true;
            if (!userTurnedOff && App.fileio.canSaveInPlace(window)) {
                setEnabled(true);   // "turns on after the first manual save in the session"
            }
            refreshToggle();
        });

        listenForComposition(window);
        // Closing the tab: start writing straight away. The browser still asks
        // "Leave site?" while changes are unsaved, which gives the write time.
        window.addEventListener('beforeunload', () => {
            if (enabled && App.history.isDirty()) {
                scheduler.notifyChange();
                scheduler.flush();
            }
        });
    };

    function makeScheduler() {
        return App.autosave.createScheduler({
            delay: timing.delay, maxWait: timing.maxWait, retryMs: 1000,
            isBusy: () => App.history.isPending() || composing || askingUser,
            save: autoSaveNow,
        });
    }

    /* Tests use short delays instead of 5 s / 30 s. */
    App.autosave.setTiming = function setTiming(delay, maxWait) {
        timing.delay = delay;
        timing.maxWait = maxWait;
        scheduler.cancel();
        scheduler = makeScheduler();
    };

    App.autosave.isEnabled = function isEnabled() {
        return enabled;
    };

    /* True when AutoSave was on and is now off (by the user, a conflict or an error). */
    App.autosave.isOff = function isOff() {
        return !enabled && switchedOff;
    };

    function listenForComposition(targetWindow) {
        targetWindow.addEventListener('compositionstart', () => { composing = true; });
        targetWindow.addEventListener('compositionend', () => { composing = false; });
    }

    function setEnabled(value, reason) {
        switchedOff = !value && (switchedOff || (enabled && !!reason));
        enabled = value;
        if (!value) {
            scheduler.cancel();
        }
        refreshToggle();
        if (reason) {
            App.ui.setStatus(reason);
        }
        App.events.emit('autosave-changed', { enabled: enabled });
    }

    async function autoSaveNow() {
        if (!enabled) {
            return;
        }
        let result;
        try {
            result = await App.fileio.autoSave();
        } catch (error) {
            setEnabled(false, 'AutoSave off');
            const why = App.fileio.isPermissionError(error)
                ? 'The browser no longer lets the editor write to this file.'
                : (error && error.message) || String(error);
            await App.dialogs.alert('AutoSave turned off', why + ' Your changes are still here: use File > Save As to keep them.');
            return;
        }
        if (result === 'conflict') {
            await resolveConflict();
        }
    }

    /* The file changed on disk since we opened or saved it: ask before writing. */
    async function resolveConflict() {
        askingUser = true;
        const choice = await App.dialogs.show({
            title: 'The file changed on disk',
            body: '"' + App.state.fileName + '" was changed outside the editor since it was opened or last saved. ' +
                'AutoSave is paused. Reload throws away the changes made here; Save as copy keeps both versions; ' +
                'Overwrite replaces the file with the deck in the editor.',
            buttons: [
                { label: 'Reload', value: 'reload' },
                { label: 'Save as copy…', value: 'copy' },
                { label: 'Overwrite', value: 'overwrite', primary: true },
            ],
        });
        askingUser = false;
        if (choice === 'overwrite') {
            await App.fileio.autoSave({ force: true });
        } else if (choice === 'copy') {
            const before = App.state.fileHandle;
            await App.fileio.saveAs();
            if (App.state.fileHandle === before) {
                setEnabled(false, 'AutoSave paused: the file changed on disk');   // Save As was cancelled
            }
        } else if (choice === 'reload') {
            await App.fileio.reloadFromDisk();
        } else {
            setEnabled(false, 'AutoSave paused: the file changed on disk');
        }
    }

    // ---------------------------------------------------------------
    // The switch in the title bar
    // ---------------------------------------------------------------

    function buildToggle() {
        toggle = App.util.el('button', {
            type: 'button', id: 'autosave-toggle', role: 'switch', 'aria-checked': 'false', hidden: true,
            onclick: onToggleClick,
        }, [App.util.el('span', { class: 'autosave-label' }, ['AutoSave']),
            App.util.el('span', { class: 'autosave-switch' }, [App.util.el('span', { class: 'autosave-knob' })]),
            App.util.el('span', { class: 'autosave-state' }, ['Off'])]);
        // Far left of the title bar, before Save / Undo / Redo, as in PowerPoint.
        document.getElementById('quick-access').prepend(toggle);
    }

    function refreshToggle() {
        // Browsers without the File System Access API (Firefox) cannot write files at all.
        toggle.hidden = !App.state.hasDeck || !App.fileio.canSaveInPlace(window);
        toggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
        toggle.querySelector('.autosave-state').textContent = enabled ? 'On' : 'Off';
        toggle.title = enabled
            ? 'AutoSave is on: changes are written to the file a few seconds after you make them.'
            : 'AutoSave is off. Click to save to a file and keep it saved automatically.';
    }

    function onToggleClick() {
        if (enabled) {
            userTurnedOff = true;
            setEnabled(false, 'AutoSave off');
            return;
        }
        userTurnedOff = false;
        if (savedToFile && App.state.fileHandle) {
            setEnabled(true, 'AutoSave on');
            if (App.history.isDirty()) {
                scheduler.notifyChange();
                scheduler.flush();
            }
            return;
        }
        // Not saved to a file yet: a manual save first (it switches AutoSave on when it succeeds).
        App.commands.run('save');
    }
})();
