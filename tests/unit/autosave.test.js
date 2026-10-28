/* Tests for src/js/autosave.js: when AutoSave writes (SPEC 6.1), with a fake clock. */

// A clock the test drives: timers only fire when the test calls advance().
function fakeTimers() {
    let now = 0;
    let nextId = 1;
    let timers = [];
    const clock = {
        now: () => now,
        setTimeout: (fn, ms) => {
            const id = nextId++;
            timers.push({ id: id, at: now + ms, fn: fn });
            return id;
        },
        clearTimeout: (id) => {
            timers = timers.filter((t) => t.id !== id);
        },
    };
    // Move time forward, firing due timers in order (and letting promises settle).
    clock.advance = async (ms) => {
        const end = now + ms;
        for (;;) {
            const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
            if (!due) {
                break;
            }
            timers = timers.filter((t) => t !== due);
            now = due.at;
            due.fn();
            await settle();
        }
        now = end;
        await settle();
    };
    return clock;
}

async function settle() {
    for (let i = 0; i < 5; i++) {
        await Promise.resolve();
    }
}

function schedulerWith(clock, extra) {
    const saves = [];
    const options = Object.assign({
        delay: 5000, maxWait: 30000, clock: clock,
        save: async () => { saves.push(clock.now()); },
    }, extra || {});
    return { scheduler: App.autosave.createScheduler(options), saves: saves };
}

test('autosave: saves 5 s after the last change', async () => {
    const clock = fakeTimers();
    const { scheduler, saves } = schedulerWith(clock);
    scheduler.notifyChange();
    await clock.advance(4999);
    assertEqual(saves, []);
    await clock.advance(1);
    assertEqual(saves, [5000]);
});

test('autosave: a new change restarts the 5 s wait', async () => {
    const clock = fakeTimers();
    const { scheduler, saves } = schedulerWith(clock);
    scheduler.notifyChange();
    await clock.advance(3000);
    scheduler.notifyChange();
    await clock.advance(4000);
    assertEqual(saves, [], 'not yet: only 4 s since the last change');
    await clock.advance(1000);
    assertEqual(saves, [8000]);
});

test('autosave: during continuous editing it still saves at least every 30 s', async () => {
    const clock = fakeTimers();
    const { scheduler, saves } = schedulerWith(clock);
    for (let t = 0; t < 40000; t += 2000) {
        scheduler.notifyChange();
        await clock.advance(2000);
    }
    assertEqual(saves[0], 30000);
});

test('autosave: never saves while busy (drag, IME); retries once it is free', async () => {
    const clock = fakeTimers();
    let busy = true;
    const { scheduler, saves } = schedulerWith(clock, { isBusy: () => busy, retryMs: 1000 });
    scheduler.notifyChange();
    await clock.advance(7000);
    assertEqual(saves, [], 'nothing while busy');
    busy = false;
    await clock.advance(1000);
    assertEqual(saves.length, 1);
});

test('autosave: never two writes at once; a change during a write is saved afterwards', async () => {
    const clock = fakeTimers();
    let finishWrite = null;
    let writes = 0;
    const scheduler = App.autosave.createScheduler({
        delay: 5000, maxWait: 30000, clock: clock,
        save: () => {
            writes += 1;
            return new Promise((resolve) => { finishWrite = resolve; });
        },
    });
    scheduler.notifyChange();
    await clock.advance(5000);
    assertEqual(writes, 1);
    scheduler.notifyChange();             // the user keeps editing while the file is written
    await clock.advance(10000);
    assertEqual(writes, 1, 'still only the first write');
    finishWrite();
    await settle();
    await clock.advance(5000);
    assertEqual(writes, 2, 'the change made during the write is saved next');
});

test('autosave: flush saves now (closing the tab); cancel forgets the pending save', async () => {
    const clock = fakeTimers();
    const { scheduler, saves } = schedulerWith(clock);
    scheduler.notifyChange();
    await clock.advance(1000);
    await scheduler.flush();
    assertEqual(saves, [1000]);
    scheduler.notifyChange();
    scheduler.cancel();
    await clock.advance(60000);
    assertEqual(saves, [1000], 'cancelled');
    await scheduler.flush();
    assertEqual(saves, [1000], 'flush with nothing pending does nothing');
});
