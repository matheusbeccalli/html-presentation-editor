/*
 * slidepicks.test.js - several slides at once, and slides on the clipboard (Phase 10 step 7).
 *
 * Shift+click in the rail picks a range, Ctrl+click one more; Delete, Duplicate,
 * Hide, Copy / Cut and dragging act on every picked slide. Copied slides go on
 * the clipboard as HTML marked data-deck-editor-slides, so they paste here or in
 * another editor tab; pasting cleans them (no scripts), drops their slide-master
 * copy, and gives them new slide and element ids.
 */

function fiveSlides() {
    return parseDoc('<!DOCTYPE html><html><head></head><body>' + ['s1', 's2', 's3', 's4', 's5'].map((id) =>
        '<section class="slide" data-slide-id="' + id + '"><div class="el" data-type="text" data-id="e' + id.slice(1) +
        '" style="left: 0px; top: 0px; width: 10px; height: 10px;"><p>' + id + '</p></div></section>').join('') + '</body></html>');
}


function deckSlideIds(doc) {
    return Array.from(doc.querySelectorAll('section.slide'), (slide) => slide.getAttribute('data-slide-id'));
}

test('slide picks: Shift+click picks the range between two slides, either way', () => {
    const ids = ['s1', 's2', 's3', 's4', 's5'];
    assertEqual(App.slides.rangeIds(ids, 's2', 's4'), ['s2', 's3', 's4']);
    assertEqual(App.slides.rangeIds(ids, 's4', 's2'), ['s2', 's3', 's4']);
    assertEqual(App.slides.rangeIds(ids, 's3', 's3'), ['s3']);
    assertEqual(App.slides.rangeIds(ids, 'x', 's2'), ['s2'], 'no anchor: just that one');
});

test('slide picks: several slides move together into a gap, in their own order', () => {
    let doc = fiveSlides();
    assertEqual(App.slides.moveBlock(doc, ['s2', 's3'], 5), true);
    assertEqual(deckSlideIds(doc), ['s1', 's4', 's5', 's2', 's3']);
    doc = fiveSlides();
    App.slides.moveBlock(doc, ['s5', 's4'], 0);
    assertEqual(deckSlideIds(doc), ['s4', 's5', 's1', 's2', 's3'], 'in deck order, whatever order they were picked in');
    doc = fiveSlides();
    App.slides.moveBlock(doc, ['s1', 's3'], 5);
    assertEqual(deckSlideIds(doc), ['s2', 's4', 's5', 's1', 's3'], 'not next to each other: they end up together');
    doc = fiveSlides();
    assertEqual([App.slides.moveBlock(doc, ['s2', 's3'], 1), App.slides.moveBlock(doc, ['s2', 's3'], 3)], [false, false],
        'dropped where they are: nothing moves');
    assertEqual(deckSlideIds(doc), ['s1', 's2', 's3', 's4', 's5']);
});

test('slide clipboard: copied slides come back cleaned, without their master copy, with new ids', () => {
    const source = fiveSlides();
    const s2 = source.querySelector('[data-slide-id="s2"]');
    s2.insertAdjacentHTML('beforeend', '<div class="master-layer"><span>logo</span></div><script>alert(1)</script>' +
        '<aside class="notes">Nota secreta</aside>');
    s2.querySelector('.el').setAttribute('onclick', 'alert(2)');
    App.comments.add(s2, { target: 'e2', author: 'MB', date: '2026-11-18T10:00:00.000Z', text: 'comentário interno' });
    const html = App.slides.clipboardHtml([s2, source.querySelector('[data-slide-id="s4"]')], 'deck-a');
    assert(html.indexOf('data-deck-editor-slides') !== -1, 'marked');
    const shown = parseDoc('<!DOCTYPE html><html><body>' + html + '</body></html>').body.textContent;
    assert(shown.indexOf('Nota secreta') === -1 && shown.indexOf('comentário interno') === -1,
        'pasted into an e-mail, no notes or comments show: ' + shown);
    const target = fiveSlides();
    const pasted = App.slides.slidesFromClipboard(html, target, 'deck-b').slides;
    assertEqual(pasted.length, 2);
    assertEqual(pasted.map((slide) => slide.ownerDocument === target), [true, true]);
    const ids = pasted.map((slide) => slide.getAttribute('data-slide-id'));
    assert(ids.every((id) => deckSlideIds(target).indexOf(id) === -1) && ids[0] !== ids[1], 'new slide ids: ' + ids);
    const elementId = pasted[0].querySelector('.el').getAttribute('data-id');
    assert(!target.querySelector('[data-id="' + elementId + '"]'), 'a new element id: ' + elementId);
    assertEqual([pasted[0].querySelector('script'), pasted[0].querySelector('.master-layer'),
        pasted[0].querySelector('.el').hasAttribute('onclick')], [null, null, false], 'cleaned');
    assertEqual(pasted[0].querySelector('aside.notes').textContent, 'Nota secreta', 'notes come along');
    assertEqual(App.comments.listOf(pasted[0]).map((c) => c.target), [elementId], 'the comment points at the copy');
    assertEqual(App.slides.slidesFromClipboard('<p>texto</p>', target, 'deck-b'), null, 'not slides: null');
});

test('slide clipboard: pictures from the internet are blocked; slide links from another deck follow or come off', () => {
    const source = fiveSlides();
    const s2 = source.querySelector('[data-slide-id="s2"]');
    s2.insertAdjacentHTML('beforeend', '<img class="el" data-type="image" data-id="e9" alt="" src="https://example.com/x.png">');
    s2.querySelector('p').innerHTML = '<a href="#slide-s4">ver anexo</a> e <a href="#slide-s1">capa</a>';
    const copied = [s2, source.querySelector('[data-slide-id="s4"]')];
    const target = fiveSlides();
    const foreign = App.slides.slidesFromClipboard(App.slides.clipboardHtml(copied, 'deck-a'), target, 'deck-b');
    assertEqual(foreign.removedRemote, 1);
    assert(foreign.slides[0].querySelector('img').getAttribute('src').indexOf('https:') !== 0, 'the remote picture is blocked');
    const newS4 = foreign.slides[1].getAttribute('data-slide-id');
    assertEqual(foreign.slides[0].querySelector('p').innerHTML, '<a href="#slide-' + newS4 + '">ver anexo</a> e capa',
        'the link to a slide that came along follows it; the other comes off');
    const same = App.slides.slidesFromClipboard(App.slides.clipboardHtml(copied, 'deck-b'), target, 'deck-b');
    assertEqual(same.slides[0].querySelectorAll('a').length, 2, 'the same deck: links kept as they are');
});
