/* Tests for src/js/settings.js (SPEC 6.3) and the status-bar text in ui.js (SPEC 6.4). */

test('settings: defaults are drafts on, 1 day, recent files off, numbers as the deck\'s language', () => {
    assertEqual(App.settings.normalize({}), { keepDrafts: true, retentionDays: 1, rememberRecent: false, numberLocale: null });
    assertEqual(App.settings.normalize(null), { keepDrafts: true, retentionDays: 1, rememberRecent: false, numberLocale: null });
});

test('settings: the number locale is pt-BR, en-US or not chosen', () => {
    const locale = (value) => App.settings.normalize({ numberLocale: value }).numberLocale;
    assertEqual([locale('pt-BR'), locale('en-US'), locale('fr-FR'), locale(undefined)], ['pt-BR', 'en-US', null, null]);
});

test('settings: retention is a whole number of days from 1 to 30', () => {
    const days = (value) => App.settings.normalize({ retentionDays: value }).retentionDays;
    assertEqual([days(0), days(1), days(7), days(30), days(31), days(2.6), days('5'), days('abc'), days(-3)],
        [1, 1, 7, 30, 30, 3, 5, 1, 1]);
});

test('settings: no drafts means no recent files either', () => {
    assertEqual(App.settings.normalize({ keepDrafts: false, rememberRecent: true }),
        { keepDrafts: false, retentionDays: 1, rememberRecent: false, numberLocale: null });
    assertEqual(App.settings.normalize({ keepDrafts: true, rememberRecent: true }).rememberRecent, true);
});

function fakeLocalStorage(initial) {
    const data = Object.assign({}, initial || {});
    return {
        data: data,
        getItem: (key) => (key in data ? data[key] : null),
        setItem: (key, value) => { data[key] = String(value); },
    };
}

test('settings: load reads saved values, and update saves them', () => {
    const store = fakeLocalStorage({ 'deck-editor-settings': JSON.stringify({ retentionDays: 5, rememberRecent: true }) });
    App.settings.load(store);
    assertEqual(App.settings.get(), { keepDrafts: true, retentionDays: 5, rememberRecent: true, numberLocale: null });
    App.settings.update({ keepDrafts: false });
    assertEqual(JSON.parse(store.data['deck-editor-settings']), { keepDrafts: false, retentionDays: 5, rememberRecent: false, numberLocale: null });
});

test('settings: unreadable or blocked storage gives the defaults, and saving does not throw', () => {
    App.settings.load(fakeLocalStorage({ 'deck-editor-settings': '{not json' }));
    assertEqual(App.settings.get(), App.settings.DEFAULTS);
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    App.settings.load(blocked);
    App.settings.update({ retentionDays: 9 });
    assertEqual(App.settings.get().retentionDays, 9, 'kept in memory for this session');
    App.settings.load(fakeLocalStorage());   // leave the defaults for later tests
});

test('status: the save state in the status bar (SPEC 6.4)', () => {
    const at = new Date(2026, 9, 27, 14, 32).getTime();
    const text = (state) => App.ui.statusText(Object.assign({
        hasDeck: true, saving: false, dirty: false, isNew: false, autosaveOff: false, draftAt: null, recoveryUnavailable: false,
    }, state));
    assertEqual(text({ hasDeck: false }), '');
    assertEqual(text({}), 'Saved');
    assertEqual(text({ isNew: true }), 'Not saved yet');
    assertEqual(text({ saving: true, dirty: true }), 'Saving…');
    assertEqual(text({ dirty: true }), 'Unsaved changes');
    assertEqual(text({ dirty: true, draftAt: at }), 'Unsaved changes · Draft saved 14:32');
    assertEqual(text({ dirty: true, autosaveOff: true }), 'AutoSave off');
    assertEqual(text({ dirty: true, autosaveOff: true, draftAt: at }), 'AutoSave off · Draft saved 14:32');
    assertEqual(text({ draftAt: at }), 'Saved', 'no draft once everything is saved');
    assertEqual(text({ dirty: true, recoveryUnavailable: true }), 'Unsaved changes · Recovery unavailable');
    assertEqual(text({ hasDeck: false, recoveryUnavailable: true }), 'Recovery unavailable');
});

test('status bar: the deck size in KB or MB, flagged above 20 MB', () => {
    assertEqual(App.ui.sizeText(300), { text: '1 KB', tooBig: false });
    assertEqual(App.ui.sizeText(655360), { text: '640 KB', tooBig: false });
    assertEqual(App.ui.sizeText(3.4 * 1024 * 1024), { text: '3.4 MB', tooBig: false });
    assertEqual(App.ui.sizeText(20 * 1024 * 1024), { text: '20.0 MB', tooBig: false });
    assertEqual(App.ui.sizeText(21 * 1024 * 1024), { text: '21.0 MB', tooBig: true });
});
