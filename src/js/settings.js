/*
 * settings.js - the editor's privacy settings (and the number locale) and the File > Settings dialog (SPEC 6.3).
 *
 *   keepDrafts      keep crash-recovery drafts in this browser      (default on)
 *   retentionDays   delete drafts after this many days, 1 to 30     (default 1)
 *   rememberRecent  keep a Recent files list                        (default off)
 *                   (only possible while drafts are kept)
 *   numberLocale    how table numbers are written: 'pt-BR' (1.234,5) or 'en-US'
 *                   (1,234.5); null until chosen: the deck's language decides
 *
 * The settings live in localStorage, not in the IndexedDB database, so
 * "Delete all drafts now" empties that database without resetting them.
 * They hold no deck content. If localStorage is blocked, the settings still
 * work for the session and fall back to the defaults next time.
 *
 * Talks to: drafts.js and recent.js (react to 'settings-changed'), storage.js
 *           (is recovery available?), dialogs.js.
 */

(function () {
    'use strict';

    App.settings = {};

    const KEY = 'deck-editor-settings';
    App.settings.DEFAULTS = Object.freeze({ keepDrafts: true, retentionDays: 1, rememberRecent: false, numberLocale: null,
        showGridlines: false, showRulers: false, pdfHintShown: false });
    const NUMBER_LOCALES = ['pt-BR', 'en-US'];

    let store = null;   // localStorage, or a fake one in the tests
    let current = Object.assign({}, App.settings.DEFAULTS);

    // ---------------------------------------------------------------
    // Pure helper (tested in tests/unit/settings.test.js)
    // ---------------------------------------------------------------

    /* Turn anything (saved JSON, form values) into valid settings. */
    App.settings.normalize = function normalize(raw) {
        const value = raw || {};
        const keepDrafts = value.keepDrafts === undefined ? App.settings.DEFAULTS.keepDrafts : !!value.keepDrafts;
        let days = Math.round(Number(value.retentionDays));
        if (!Number.isFinite(days) || days < 1) {
            days = App.settings.DEFAULTS.retentionDays;
        }
        return {
            keepDrafts: keepDrafts,
            retentionDays: Math.min(30, days),
            rememberRecent: keepDrafts && !!value.rememberRecent,   // no drafts means no recent files either
            numberLocale: NUMBER_LOCALES.indexOf(value.numberLocale) !== -1 ? value.numberLocale : null,
            showGridlines: !!value.showGridlines,   // View tab (rulers.js)
            showRulers: !!value.showRulers,
            pdfHintShown: !!value.pdfHintShown,   // Export > PDF's "Save as PDF" hint, shown the first time only (pdf.js)
        };
    };

    // ---------------------------------------------------------------
    // Reading and saving
    // ---------------------------------------------------------------

    App.settings.init = function init() {
        let local = null;
        try {
            local = window.localStorage;
        } catch (error) {
            local = null;   // blocked: defaults for this session
        }
        App.settings.load(local);
    };

    /* Read the settings from `storage` (an object with getItem/setItem). */
    App.settings.load = function load(storage) {
        store = storage;
        current = Object.assign({}, App.settings.DEFAULTS);
        try {
            const text = store && store.getItem(KEY);
            if (text) {
                current = App.settings.normalize(JSON.parse(text));
            }
        } catch (error) {
            console.warn('Settings could not be read; using the defaults.', error);
        }
    };

    App.settings.get = function get() {
        return Object.assign({}, current);
    };

    /* Change some settings, save them, and tell the other modules. */
    App.settings.update = function update(patch) {
        const before = App.settings.get();
        current = App.settings.normalize(Object.assign({}, current, patch));
        try {
            if (store) {
                store.setItem(KEY, JSON.stringify(current));
            }
        } catch (error) {
            console.warn('Settings could not be saved; they apply to this session only.', error);
        }
        if (App.events) {
            App.events.emit('settings-changed', { before: before, after: App.settings.get() });
        }
    };

    // ---------------------------------------------------------------
    // File > Settings
    // ---------------------------------------------------------------

    const el = (...args) => App.util.el(...args);

    App.settings.openDialog = async function openDialog() {
        const settings = App.settings.get();
        const available = App.storage.isAvailable();

        const keep = el('input', { type: 'checkbox', id: 'settings-keep-drafts' });
        keep.checked = settings.keepDrafts;
        const days = el('input', { type: 'number', id: 'settings-retention', min: '1', max: '30', step: '1' });
        days.value = String(settings.retentionDays);
        const recent = el('input', { type: 'checkbox', id: 'settings-recent' });
        recent.checked = settings.rememberRecent;

        const syncControls = () => {
            if (!keep.checked) {
                recent.checked = false;
            }
            keep.disabled = !available;
            days.disabled = !available || !keep.checked;
            recent.disabled = !available || !keep.checked;
        };
        keep.addEventListener('change', syncControls);
        syncControls();

        const result = el('p', { class: 'settings-result', role: 'status' });
        const deleteAll = el('button', {
            type: 'button', class: 'btn btn-danger', id: 'settings-delete-all', disabled: !available,
            onclick: async () => {
                const ok = await App.drafts.deleteAll();
                result.textContent = ok
                    ? 'All drafts and recent files were deleted. While a deck has unsaved changes, a new draft is made ' +
                      'again after 30 seconds, unless drafts are turned off.'
                    : 'Nothing could be deleted: the browser storage is not available.';
            },
        }, ['Delete all drafts now']);

        const body = el('div', { class: 'settings' }, [
            el('h3', {}, ['Crash recovery']),
            available ? '' : el('p', { class: 'settings-warning' }, [
                'Recovery is unavailable: this browser blocks storage for pages opened from disk. ' +
                'AutoSave to the file still works.']),
            el('label', { class: 'settings-row' }, [keep, ' Keep recovery drafts in this browser']),
            el('label', { class: 'settings-row' }, ['Delete drafts after ', days, ' days (1–30)']),
            el('label', { class: 'settings-row' }, [recent, ' Remember recent files (file names only, in this browser)']),
            el('p', { class: 'settings-note' }, [
                'Drafts stay only in this browser profile on this computer. They are never uploaded or synced. ' +
                'They are deleted when you save the deck, and in any case after the number of days above. ' +
                'Other HTML files you open from disk in this browser can read them.']),
            el('div', { class: 'settings-row' }, [deleteAll]),
            result,
        ]);

        const choice = await App.dialogs.show({
            title: 'Settings',
            body: body,
            buttons: [{ label: 'Cancel', value: false }, { label: 'OK', value: true, primary: true }],
        });
        if (choice === true && available) {
            App.settings.update({ keepDrafts: keep.checked, retentionDays: days.value, rememberRecent: recent.checked });
        }
    };
})();
