/* Tests for src/js/shortcuts.js (the central keyboard-shortcut registry) */

// A fake keyboard event: only the fields the registry reads.
function fakeKey(key, mods, target) {
    mods = mods || {};
    let prevented = false;
    return {
        key: key,
        ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt, shiftKey: !!mods.shift,
        target: target || document.body,
        isComposing: !!mods.composing,
        preventDefault: () => { prevented = true; },
        wasPrevented: () => prevented,
    };
}

test('shortcuts: normalizeCombo puts modifiers in a fixed order', () => {
    assertEqual(App.shortcuts.normalizeCombo('shift+ctrl+s'), 'Ctrl+Shift+S');
    assertEqual(App.shortcuts.normalizeCombo('Ctrl+z'), 'Ctrl+Z');
    assertEqual(App.shortcuts.normalizeCombo('pagedown'), 'PageDown');
    assertEqual(App.shortcuts.normalizeCombo('space'), 'Space');
});

test('shortcuts: comboFromEvent reads modifiers and key', () => {
    assertEqual(App.shortcuts.comboFromEvent(fakeKey('s', { ctrl: true })), 'Ctrl+S');
    assertEqual(App.shortcuts.comboFromEvent(fakeKey('S', { ctrl: true, shift: true })), 'Ctrl+Shift+S');
    assertEqual(App.shortcuts.comboFromEvent(fakeKey(' ')), 'Space');
    assertEqual(App.shortcuts.comboFromEvent(fakeKey('F5', { shift: true })), 'Shift+F5');
});

test('shortcuts: Cmd on a Mac counts as Ctrl', () => {
    assertEqual(App.shortcuts.comboFromEvent(fakeKey('z', { meta: true })), 'Ctrl+Z');
});

test('shortcuts: Shift is implied for symbols like "?"', () => {
    assertEqual(App.shortcuts.comboFromEvent(fakeKey('?', { shift: true })), '?');
});

test('shortcuts: isTypingTarget recognises text fields', () => {
    const input = document.createElement('input');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);
    try {
        assert(App.shortcuts.isTypingTarget(input), 'text input');
        assert(App.shortcuts.isTypingTarget(document.createElement('textarea')), 'textarea');
        assert(App.shortcuts.isTypingTarget(editable), 'contenteditable');
        assert(!App.shortcuts.isTypingTarget(checkbox), 'checkbox is not typing');
        assert(!App.shortcuts.isTypingTarget(document.createElement('div')), 'plain div');
    } finally {
        editable.remove();
    }
});

test('shortcuts: registry runs the mapped command and prevents the browser default', () => {
    const registry = App.shortcuts.createRegistry();
    const ran = [];
    registry.register('Ctrl+S', 'save');
    const event = fakeKey('s', { ctrl: true });
    const handled = registry.handle(event, (command) => ran.push(command));
    assert(handled, 'handled');
    assert(event.wasPrevented(), 'default prevented');
    assertEqual(ran, ['save']);
});

test('shortcuts: ignored while typing unless marked whileTyping', () => {
    const registry = App.shortcuts.createRegistry();
    const ran = [];
    registry.register('Ctrl+Z', 'undo');
    registry.register('Ctrl+B', 'bold', { whileTyping: true });
    const textarea = document.createElement('textarea');
    registry.handle(fakeKey('z', { ctrl: true }, textarea), (c) => ran.push(c));
    registry.handle(fakeKey('b', { ctrl: true }, textarea), (c) => ran.push(c));
    assertEqual(ran, ['bold']);
});

test('shortcuts: a disabled command leaves the key to the browser (e.g. Escape closes a dialog)', () => {
    const registry = App.shortcuts.createRegistry();
    const ran = [];
    registry.register('Escape', 'deselect');
    const event = fakeKey('Escape');
    const handled = registry.handle(event, (c) => ran.push(c), () => false);
    assert(!handled, 'not handled');
    assert(!event.wasPrevented(), 'default not prevented');
    assertEqual(ran, []);
});

test('shortcuts: blockBrowserDefault keeps the browser away even when the command is disabled', () => {
    const registry = App.shortcuts.createRegistry();
    registry.register('Ctrl+S', 'save', { blockBrowserDefault: true });
    const event = fakeKey('s', { ctrl: true });
    const ran = [];
    registry.handle(event, (c) => ran.push(c), () => false);
    assert(event.wasPrevented(), "no 'Save page as' window from the browser");
    assertEqual(ran, []);
});

test('shortcuts: ignored while a dialog is open (keys belong to the dialog)', () => {
    const registry = App.shortcuts.createRegistry();
    const ran = [];
    registry.register('Escape', 'deselect');
    const dialog = document.createElement('dialog');
    const button = document.createElement('button');
    dialog.appendChild(button);
    const event = fakeKey('Escape', {}, button);
    registry.handle(event, (c) => ran.push(c), () => true);
    assertEqual(ran, []);
    assert(!event.wasPrevented(), 'default not prevented');
});

test('shortcuts: ignored during IME composition', () => {
    const registry = App.shortcuts.createRegistry();
    const ran = [];
    registry.register('Ctrl+S', 'save', { whileTyping: true });
    registry.handle(fakeKey('s', { ctrl: true, composing: true }), (c) => ran.push(c));
    assertEqual(ran, []);
});

test('shortcuts: registering the same combo twice is an error', () => {
    const registry = App.shortcuts.createRegistry();
    registry.register('Ctrl+S', 'save');
    assertThrows(() => registry.register('ctrl+s', 'other'));
});

test('shortcuts: list() returns every shortcut for the cheat sheet', () => {
    const registry = App.shortcuts.createRegistry();
    registry.register('Ctrl+S', 'save');
    registry.register('Ctrl+Z', 'undo');
    assertEqual(registry.list().map((s) => s.combo), ['Ctrl+S', 'Ctrl+Z']);
});
