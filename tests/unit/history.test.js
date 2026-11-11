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

function slideIds(doc) {
    return Array.from(doc.querySelectorAll('section.slide'), (slide) => slide.getAttribute('data-slide-id')).join(',');
}

function deckWithThreeSlidesAndMaster() {
    return parseDoc(
        '<html><head></head><body>' +
        '<section class="slide" data-slide-id="s1"><div class="el" data-id="e1">One</div></section>' +
        '<section class="slide" data-slide-id="s2"><div class="el" data-id="e2">Two</div></section>' +
        '<section class="slide" data-slide-id="s3"><div class="el" data-id="e3">Three</div></section>' +
        '<div class="master"><div class="el" data-id="m1">Logo</div></div>' +
        '</body></html>'
    );
}

test('history: slides scope - deleting a slide is undone in place and redone', () => {
    const doc = deckWithThreeSlidesAndMaster();
    const history = App.createHistory({ getDoc: () => doc });
    history.change('Delete slide', { slides: ['s2'] }, () => doc.querySelector('[data-slide-id="s2"]').remove());
    assertEqual(slideIds(doc), 's1,s3');
    history.undo();
    assertEqual(slideIds(doc), 's1,s2,s3', 'back in its place');
    assertEqual(textOf(doc, 'e2'), 'Two', 'with its content');
    history.redo();
    assertEqual(slideIds(doc), 's1,s3', 'deleted again');
    assertEqual(doc.body.lastElementChild.className, 'master', 'the master stays where it was');
});

test('history: slides scope - an added slide goes on undo and comes back on redo', () => {
    const doc = deckWithThreeSlidesAndMaster();
    const history = App.createHistory({ getDoc: () => doc });
    history.change('New slide', { slides: ['s9'] }, () => {
        const slide = doc.createElement('section');
        slide.className = 'slide';
        slide.setAttribute('data-slide-id', 's9');
        slide.innerHTML = '<div class="el" data-id="e9">Nine</div>';
        doc.querySelector('[data-slide-id="s1"]').after(slide);
    });
    assertEqual(slideIds(doc), 's1,s9,s2,s3');
    history.undo();
    assertEqual(slideIds(doc), 's1,s2,s3');
    history.redo();
    assertEqual(slideIds(doc), 's1,s9,s2,s3', 'in the same place');
    assertEqual(textOf(doc, 'e9'), 'Nine');
});

test('history: slides scope - the slide order is undone (no slide listed)', () => {
    const doc = deckWithThreeSlidesAndMaster();
    const history = App.createHistory({ getDoc: () => doc });
    history.change('Move slide', { slides: [] }, () => {
        doc.querySelector('[data-slide-id="s3"]').after(doc.querySelector('[data-slide-id="s1"]'));
    });
    assertEqual(slideIds(doc), 's2,s3,s1');
    history.undo();
    assertEqual(slideIds(doc), 's1,s2,s3');
    history.redo();
    assertEqual(slideIds(doc), 's2,s3,s1');
});

test('history: slides scope - only the listed slides are copied, the others are the live ones', () => {
    const doc = deckWithThreeSlidesAndMaster();
    const history = App.createHistory({ getDoc: () => doc });
    const s1 = doc.querySelector('[data-slide-id="s1"]');
    history.change('Delete slide', { slides: ['s2'] }, () => doc.querySelector('[data-slide-id="s2"]').remove());
    history.undo();
    assert(doc.querySelector('[data-slide-id="s1"]') === s1, 'slide 1 was not rebuilt from a copy');
});

test('history: slides scope - slide edits before and after a delete undo in the right order', () => {
    const doc = deckWithThreeSlidesAndMaster();
    const history = App.createHistory({ getDoc: () => doc });
    history.change('Edit', { slideId: 's2' }, () => {
        doc.querySelector('[data-id="e2"]').textContent = 'Edited';
    });
    history.change('Delete slide', { slides: ['s2'] }, () => doc.querySelector('[data-slide-id="s2"]').remove());
    history.undo();
    assertEqual(textOf(doc, 'e2'), 'Edited');
    history.undo();
    assertEqual(textOf(doc, 'e2'), 'Two');
    history.redo();
    history.redo();
    assertEqual(slideIds(doc), 's1,s3');
    history.undo();
    assertEqual(textOf(doc, 'e2'), 'Edited', 'the deleted slide as it was when deleted');
});

test('history: slides scope - a failed change puts the slides back', () => {
    const doc = deckWithThreeSlidesAndMaster();
    const history = App.createHistory({ getDoc: () => doc });
    assertThrows(() => history.change('Delete slide', { slides: ['s2'] }, () => {
        doc.querySelector('[data-slide-id="s2"]').remove();
        throw new Error('boom');
    }));
    assertEqual(slideIds(doc), 's1,s2,s3');
    assert(!history.canUndo(), 'nothing recorded');
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

test('history: markSaved(stateId) records the state that was written, not a later one', () => {
    // An async save serializes the deck, the user keeps editing, then the write finishes.
    const doc = deckWithTwoSlides();
    const history = App.createHistory({ getDoc: () => doc });
    history.change('A', { slideId: 's1' }, () => setText(doc, 'e1', 'A'));
    const written = history.stateId();
    history.change('B', { slideId: 's1' }, () => setText(doc, 'e1', 'B'));   // during the write
    history.markSaved(written);
    assert(history.isDirty(), 'change B is not saved yet');
    history.undo();
    assert(!history.isDirty(), 'undoing B goes back to the saved state');
});

test('history: isPending is true between begin and commit (a drag in progress)', () => {
    const doc = deckWithTwoSlides();
    const history = App.createHistory({ getDoc: () => doc });
    assert(!history.isPending());
    history.begin('Move', { slideId: 's1' });
    assert(history.isPending());
    history.commit();
    assert(!history.isPending());
});

// ---- Phase 3: text steps carry the cursor (meta) and typing is a pending step ----

test('history: undo and redo report the step\'s meta (e.g. where the text cursor was)', () => {
    const doc = deckWithTwoSlides();
    const events = [];
    const history = App.createHistory({ getDoc: () => doc, onChange: (info) => events.push(info) });
    const meta = { caretBefore: 1, caretAfter: 2 };
    history.change('Bold', { slideId: 's1' }, () => {
        doc.querySelector('[data-id="e1"]').textContent = 'B';
    }, { meta: meta });
    history.undo();
    history.redo();
    assertEqual(events.filter((e) => e.action === 'undo' || e.action === 'redo').map((e) => [e.action, e.meta]),
        [['undo', meta], ['redo', meta]]);
});

test('history: a pending step runs its onCommit and is committed before another change', () => {
    const doc = deckWithTwoSlides();
    const history = App.createHistory({ getDoc: () => doc });
    const meta = {};
    history.begin('Typing', { slideId: 's1' }, { meta: meta, onCommit: () => { meta.caretAfter = 5; } });
    doc.querySelector('[data-id="e1"]').textContent = 'typed';
    history.change('Other', { slideId: 's2' }, () => {
        doc.querySelector('[data-id="e2"]').textContent = 'other';
    });
    assert(!history.isPending(), 'the typing step was committed');
    assertEqual(meta.caretAfter, 5);
    assertEqual(history.undoLabel(), 'Other');
    history.undo();
    assertEqual(history.undoLabel(), 'Typing', 'typing is its own step, before the other change');
    history.undo();
    assertEqual(textOf(doc, 'e1'), 'One');
});

test('history: undo commits a pending step first, then undoes it', () => {
    const doc = deckWithTwoSlides();
    const history = App.createHistory({ getDoc: () => doc });
    history.begin('Typing', { slideId: 's1' });
    doc.querySelector('[data-id="e1"]').textContent = 'typed';
    assert(history.undo(), 'there was something to undo');
    assertEqual(textOf(doc, 'e1'), 'One');
    assert(history.redo(), 'and redo brings the typing back');
    assertEqual(textOf(doc, 'e1'), 'typed');
});

test('history: a pending step (typing) can be undone even when nothing came before it', () => {
    const doc = deckWithTwoSlides();
    const history = App.createHistory({ getDoc: () => doc });
    assert(!history.canUndo(), 'nothing to undo on a fresh deck');
    history.begin('Typing', { slideId: 's1' });
    doc.querySelector('[data-id="e1"]').textContent = 'One7';
    assert(history.canUndo(), 'the typing still being recorded counts: Ctrl+Z is enabled');
    assertEqual(history.undoLabel(), 'Typing');
    assert(history.undo(), 'undo returns true');
    assertEqual(textOf(doc, 'e1'), 'One');
    assert(!history.canUndo(), 'nothing left');
});
