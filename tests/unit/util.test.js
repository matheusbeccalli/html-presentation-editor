/* Tests for src/js/util.js and src/js/events.js */

test('util: 96 px is one inch, and back', () => {
    assertEqual(App.util.pxToInches(96), 1);
    assertEqual(App.util.pxToInches(1280), 13.333333333333334);
    assertEqual(App.util.inchesToPx(7.5), 720);
});

test('util: scalePxValues scales every px number', () => {
    assertEqual(App.util.scalePxValues('10px 20px', 0.5), '5px 10px');
    assertEqual(App.util.scalePxValues('-3px 0px 4.5px rgba(0, 0, 0, 0.5)', 2), '-6px 0px 9px rgba(0, 0, 0, 0.5)');
});

test('util: scalePxValues rounds to two decimals', () => {
    assertEqual(App.util.scalePxValues('10px', 2 / 3), '6.67px');
});

test('util: scalePxValues leaves url() values untouched (base64 may contain "px")', () => {
    const value = 'url("data:image/png;base64,AA3pxBB")';
    assertEqual(App.util.scalePxValues(value, 0.5), value);
});

test('util: scalePxValues leaves non-px values alone', () => {
    assertEqual(App.util.scalePxValues('normal', 0.5), 'normal');
    assertEqual(App.util.scalePxValues('1.5', 0.5), '1.5');
});

test('util: formatBytes is human readable', () => {
    assertEqual(App.util.formatBytes(512), '512 B');
    assertEqual(App.util.formatBytes(1536), '1.5 KB');
    assertEqual(App.util.formatBytes(5 * 1024 * 1024), '5.0 MB');
});

test('util: escapeHtml escapes the five special characters', () => {
    assertEqual(App.util.escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('util: uniqueId skips ids already used', () => {
    const used = new Set(['e1', 'e2', 'e4']);
    assertEqual(App.util.uniqueId('e', used), 'e3');
    assert(used.has('e3'), 'the new id is added to the set');
});

test('events: on/emit/off', () => {
    const bus = App.createEventBus();
    const seen = [];
    const listener = (data) => seen.push(data);
    bus.on('changed', listener);
    bus.emit('changed', 1);
    bus.off('changed', listener);
    bus.emit('changed', 2);
    assertEqual(seen, [1]);
});

test('events: one failing listener does not stop the others', () => {
    const bus = App.createEventBus();
    const seen = [];
    bus.on('x', () => { throw new Error('boom'); });
    bus.on('x', () => seen.push('second'));
    const originalError = console.error;
    console.error = () => {};
    try {
        bus.emit('x');
    } finally {
        console.error = originalError;
    }
    assertEqual(seen, ['second']);
});
