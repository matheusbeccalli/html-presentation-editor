/* Tests for src/js/history.js (undo/redo with slide snapshots) */

function deckWithTwoSlides() {
    return parseDoc(
        '<html><head><style>.a{}</style></head><body>' +
        '<section class="slide" data-slide-id="s1"><div class="el" data-id="e1">One</div></section>' +
        '<section class="slide" data-slide-id="s2"><div class="el" data-id="e2">Two</div></section>' +
        '</body></html>'
    );
}

function textOf(doc, id) {
    return doc.querySelector('[data-id="' + id + '"]').textContent;
}

test('history: undo restores the slide as it was before the change', () => {
    const doc = deckWithTwoSlides();
    const history = App.createHistory({ getDoc: () => doc });
    history.change('Edit text', { slideId: 's1' }, () => {
        doc.querySelector('[data-id="e1"]').textContent = 'Changed';
    });
    assertEqual(textOf(doc, 'e1'), 'Changed');
    assert(history.undo(), 'undo returns true');
    assertEqual(textOf(doc, 'e1'), 'One');
});

test('history: redo re-applies the undone change', () => {
    const doc = deckWithTwoSlides();
    const history = App.createHistory({ getDoc: () => doc });
    history.change('Edit', { slideId: 's1' }, () => {
        doc.querySelector('[data-id="e1"]').textContent = 'Changed';
    });
    history.undo();
    assert(history.redo(), 'redo returns true');
    assertEqual(textOf(doc, 'e1'), 'Changed');
});

test('history: undo only touches the affected slide', () => {
    const doc = deckWithTwoSlides();
    const history = App.createHistory({ getDoc: () => doc });
    history.change('Edit s1', { slideId: 's1' }, () => {
        doc.querySelector('[data-id="e1"]').textContent = 'Changed';
    });
    // A change outside history on slide 2 (e.g. made by another test) must survive undo of s1.
    doc.querySelector('[data-id="e2"]').textContent = 'Untouched by undo';
    history.undo();
    assertEqual(textOf(doc, 'e2'), 'Untouched by undo');
});

test('history: deck scope snapshots head and body', () => {
    const doc = deckWithTwoSlides();
    const history = App.createHistory({ getDoc: () => doc });
    history.change('Remove style and slide', 'deck', () => {
        doc.querySelector('style').remove();
        doc.querySelector('[data-slide-id="s2"]').remove();
    });
    assertEqual(doc.querySelectorAll('.slide').length, 1);
    history.undo();
    assertEqual(doc.querySelectorAll('.slide').length, 2);
    assertEqual(doc.querySelectorAll('style').length, 1);
});

test('history: a new change clears the redo stack', () => {
    const doc = deckWithTwoSlides();
    const history = App.createHistory({ getDoc: () => doc });
    history.change('A', { slideId: 's1' }, () => {});
    history.undo();
    assert(history.canRedo(), 'can redo before new change');
    history.change('B', { slideId: 's1' }, () => {});
    assert(!history.canRedo(), 'redo cleared');
});

test('history: keeps at most `limit` steps', () => {
    const doc = deckWithTwoSlides();
    const history = App.createHistory({ getDoc: () => doc, limit: 100 });
    for (let i = 0; i < 105; i++) {
        history.change('Step ' + i, { slideId: 's1' }, () => {
            doc.querySelector('[data-id="e1"]').textContent = 'v' + i;
        });
    }
    let undos = 0;
    while (history.undo()) {
        undos += 1;
    }
    assertEqual(undos, 100);
    assertEqual(textOf(doc, 'e1'), 'v4', 'the oldest 5 steps were dropped');
});

test('history: undo with nothing to undo returns false', () => {
    const history = App.createHistory({ getDoc: () => deckWithTwoSlides() });
    assert(!history.undo());
    assert(!history.redo());
});

test('history: dirty tracking follows saves, undo and redo', () => {
    const doc = deckWithTwoSlides();
    const history = App.createHistory({ getDoc: () => doc });
    assert(!history.isDirty(), 'clean at start');
    history.change('A', { slideId: 's1' }, () => {});
    assert(history.isDirty(), 'dirty after change');
    history.markSaved();
    assert(!history.isDirty(), 'clean after save');
    history.undo();
    assert(history.isDirty(), 'undo past the save point is dirty');
    history.redo();
    assert(!history.isDirty(), 'redo back to the saved state is clean');
});

test('history: markDirty makes an imported-but-converted deck dirty', () => {
    const history = App.createHistory({ getDoc: () => deckWithTwoSlides() });
    history.markDirty();
    assert(history.isDirty());
});

test('history: reset forgets everything', () => {
    const doc = deckWithTwoSlides();
    const history = App.createHistory({ getDoc: () => doc });
    history.change('A', { slideId: 's1' }, () => {});
    history.reset();
    assert(!history.canUndo());
    assert(!history.isDirty());
});

test('history: onChange is called after change, undo and redo', () => {
    const doc = deckWithTwoSlides();
    const calls = [];
    const history = App.createHistory({ getDoc: () => doc, onChange: (info) => calls.push(info.action) });
    history.change('A', { slideId: 's1' }, () => {});
    history.undo();
    history.redo();
    assertEqual(calls, ['change', 'undo', 'redo']);
});

test('history: a change whose function throws is rolled back and not recorded', () => {
    const doc = deckWithTwoSlides();
    const history = App.createHistory({ getDoc: () => doc });
    assertThrows(() => history.change('Broken', { slideId: 's1' }, () => {
        doc.querySelector('[data-id="e1"]').textContent = 'half done';
        throw new Error('oops');
    }));
    assertEqual(textOf(doc, 'e1'), 'One');
    assert(!history.canUndo());
});

test('history: begin/commit records one step for a long interaction (drag)', () => {
    const doc = deckWithTwoSlides();
    const history = App.createHistory({ getDoc: () => doc });
    history.begin('Move', { slideId: 's1' });
    doc.querySelector('[data-id="e1"]').textContent = 'step 1';
    doc.querySelector('[data-id="e1"]').textContent = 'step 2';
    history.commit();
    history.undo();
    assertEqual(textOf(doc, 'e1'), 'One');
    assert(!history.canUndo(), 'only one step was recorded');
});

test('history: cancel restores the state from begin', () => {
    const doc = deckWithTwoSlides();
    const history = App.createHistory({ getDoc: () => doc });
    history.begin('Move', { slideId: 's1' });
    doc.querySelector('[data-id="e1"]').textContent = 'moving';
    history.cancel();
    assertEqual(textOf(doc, 'e1'), 'One');
    assert(!history.canUndo());
});

test('history: undoLabel names the next step', () => {
    const doc = deckWithTwoSlides();
    const history = App.createHistory({ getDoc: () => doc });
    history.change('Remove blocked references', 'deck', () => {});
    assertEqual(history.undoLabel(), 'Remove blocked references');
    history.undo();
    assertEqual(history.redoLabel(), 'Remove blocked references');
});

// A clock the test controls, so "within one second" needs no real waiting.
function fakeClock() {
    let now = 1000;
    return { now: () => now, advance: (ms) => { now += ms; } };
}

function setText(doc, id, text) {
    doc.querySelector('[data-id="' + id + '"]').textContent = text;
}

test('history: changes with the same mergeKey within a second become one undo step (held arrow key)', () => {
    const doc = deckWithTwoSlides();
    const clock = fakeClock();
    const history = App.createHistory({ getDoc: () => doc, now: clock.now });
    ['A', 'B', 'C'].forEach((text) => {
        history.change('Nudge', { slideId: 's1' }, () => setText(doc, 'e1', text), { mergeKey: 'nudge:e1' });
        clock.advance(200);
    });
    history.undo();
    assertEqual(textOf(doc, 'e1'), 'One', 'one undo goes back to before the first nudge');
    assert(!history.canUndo(), 'only one step was recorded');
    history.redo();
    assertEqual(textOf(doc, 'e1'), 'C', 'redo goes to the last nudge');
});

test('history: no merging after a pause, with another key, or across a save', () => {
    const doc = deckWithTwoSlides();
    const clock = fakeClock();
    const history = App.createHistory({ getDoc: () => doc, now: clock.now });
    const nudge = (text, key) => history.change('Nudge', { slideId: 's1' }, () => setText(doc, 'e1', text), { mergeKey: key });
    nudge('A', 'k');
    clock.advance(1500);
    nudge('B', 'k');            // after a pause: new step
    nudge('C', 'other');        // different key: new step
    history.markSaved();
    nudge('D', 'other');        // after a save: new step, so the deck becomes dirty again
    assert(history.isDirty(), 'dirty after the change that followed the save');
    let steps = 0;
    while (history.undo()) {
        steps += 1;
    }
    assertEqual(steps, 4);
});

test('history: a merged change still notifies listeners (thumbnails, autosave)', () => {
    const doc = deckWithTwoSlides();
    const calls = [];
    const history = App.createHistory({ getDoc: () => doc, onChange: (info) => calls.push(info.action) });
    history.change('Nudge', { slideId: 's1' }, () => setText(doc, 'e1', 'A'), { mergeKey: 'k' });
    history.change('Nudge', { slideId: 's1' }, () => setText(doc, 'e1', 'B'), { mergeKey: 'k' });
    assertEqual(calls, ['change', 'change']);
});
