/* Tests for the pure parts of src/js/drafts.js and the deck id in deck.js (SPEC 6.2). */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

test('drafts: formatTime shows day/month hour:minute', () => {
    assertEqual(App.drafts.formatTime(new Date(2026, 9, 27, 14, 32).getTime()), '27/10 14:32');
    assertEqual(App.drafts.formatTime(new Date(2026, 0, 5, 9, 7).getTime()), '05/01 09:07');
});

test('drafts: idsToPrune keeps the newest 5 of a deck', () => {
    const drafts = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: n, deckId: 'd', savedAt: n * 1000 }));
    assertEqual(App.drafts.idsToPrune(drafts, 5), [1, 2]);
    assertEqual(App.drafts.idsToPrune(drafts.slice(0, 3), 5), []);
});

test('drafts: idsToPrune counts each deck separately', () => {
    const drafts = [
        { id: 1, deckId: 'a', savedAt: 1 }, { id: 2, deckId: 'a', savedAt: 2 }, { id: 3, deckId: 'a', savedAt: 3 },
        { id: 4, deckId: 'b', savedAt: 4 }, { id: 5, deckId: 'b', savedAt: 5 },
    ];
    assertEqual(App.drafts.idsToPrune(drafts, 2), [1]);
});

test('drafts: expiredIds finds drafts older than the retention period', () => {
    const now = 10 * DAY;
    const drafts = [
        { id: 1, savedAt: now - DAY - 1 },    // just over 1 day old
        { id: 2, savedAt: now - DAY + HOUR }, // under 1 day
        { id: 3, savedAt: now - 3 * DAY },
    ];
    assertEqual(App.drafts.expiredIds(drafts, now, 1), [1, 3]);
    assertEqual(App.drafts.expiredIds(drafts, now, 30), []);
});

test('drafts: newestPerDeck gives one draft per deck, newest deck first', () => {
    const drafts = [
        { id: 1, deckId: 'a', savedAt: 10 }, { id: 2, deckId: 'a', savedAt: 30 },
        { id: 3, deckId: 'b', savedAt: 40 }, { id: 4, deckId: 'c', savedAt: 20 },
    ];
    assertEqual(App.drafts.newestPerDeck(drafts).map((d) => d.id), [3, 2, 4]);
    assertEqual(App.drafts.newestPerDeck([]), []);
});

function slideDoc(slides) {
    return parseDoc('<html><body>' + slides.map(([id, text, extra]) =>
        '<section class="slide" data-slide-id="' + id + '"' + (extra || '') + '><p>' + text + '</p></section>').join('') +
        '</body></html>');
}

test('drafts: slideList ignores editor marks such as the current-slide flag', () => {
    const plain = App.drafts.slideList(slideDoc([['s1', 'Hello']]));
    const marked = App.drafts.slideList(slideDoc([['s1', 'Hello', ' data-editor-current=""']]));
    assertEqual(marked, plain);
    assertEqual(plain[0].id, 's1');
});

test('drafts: diffSlides lists changed, added and removed slides', () => {
    const base = App.drafts.slideList(slideDoc([['s1', 'Same'], ['s2', 'Old text'], ['s3', 'Gone']]));
    const draft = App.drafts.slideList(slideDoc([['s1', 'Same'], ['s2', 'New text'], ['s4', 'Added']]));
    assertEqual(App.drafts.diffSlides(base, draft), {
        slides: [
            { status: 'changed', baseIndex: 1, draftIndex: 1 },
            { status: 'added', baseIndex: null, draftIndex: 2 },
            { status: 'removed', baseIndex: 2, draftIndex: null },
        ],
        orderChanged: false,
    });
});

test('drafts: diffSlides reports a new slide order without marking every slide', () => {
    const base = App.drafts.slideList(slideDoc([['s1', 'A'], ['s2', 'B'], ['s3', 'C']]));
    const draft = App.drafts.slideList(slideDoc([['s2', 'B'], ['s1', 'A'], ['s3', 'C']]));
    assertEqual(App.drafts.diffSlides(base, draft), { slides: [], orderChanged: true });
    const inserted = App.drafts.slideList(slideDoc([['s1', 'A'], ['s9', 'New'], ['s2', 'B'], ['s3', 'C']]));
    assertEqual(App.drafts.diffSlides(base, inserted).orderChanged, false, 'an inserted slide is not a reorder');
});

test('deck: newDeckId gives 32 random hex characters', () => {
    const a = App.deck.newDeckId();
    const b = App.deck.newDeckId();
    assert(/^[0-9a-f]{32}$/.test(a), 'format: ' + a);
    assert(a !== b, 'two ids differ');
});

test('deck: ensureDeckId keeps an existing id', () => {
    const doc = parseDoc('<html><head><meta name="deck-id" content="abc"></head><body></body></html>');
    assertEqual(App.deck.ensureDeckId(doc, 'other'), 'abc');
    assertEqual(doc.querySelectorAll('meta[name="deck-id"]').length, 1);
});

test('deck: ensureDeckId adds the fallback id, or a new one', () => {
    const doc = parseDoc('<html><head><meta name="deck-format" content="1"></head><body></body></html>');
    assertEqual(App.deck.ensureDeckId(doc, 'kept'), 'kept');
    assertEqual(doc.querySelector('meta[name="deck-id"]').getAttribute('content'), 'kept');
    const fresh = parseDoc('<html><head></head><body></body></html>');
    assert(/^[0-9a-f]{32}$/.test(App.deck.ensureDeckId(fresh, null)));
});

test('serialize: the deck id is saved with the deck', () => {
    const doc = parseDoc('<html><head><meta name="deck-id" content="abc"></head><body></body></html>');
    assertIncludes(App.serialize.toHtml(doc, { playerJs: '', playerCss: '' }), '<meta name="deck-id" content="abc">');
});
