/* Tests for src/js/canvas.js: the zoom maths. */

test('canvas: clampZoom keeps manual zoom between 50% and 400%, in whole percents', () => {
    assertEqual(App.canvas.clampZoom(0.1), 0.5);
    assertEqual(App.canvas.clampZoom(9), 4);
    assertEqual(App.canvas.clampZoom(1.234), 1.23);
});

test('canvas: one wheel notch zooms 10% in or out (and stays in range)', () => {
    assertEqual(App.canvas.wheelZoom(1, -100), 1.1);
    assertEqual(App.canvas.wheelZoom(1.1, 100), 1);
    assertEqual(App.canvas.wheelZoom(4, -100), 4);
    assertEqual(App.canvas.wheelZoom(0.5, 100), 0.5);
});

test('canvas: fitZoom is the largest zoom that shows the whole slide with a margin', () => {
    // 1280x720 slide in a 1344x784 area with 32 px margins -> exactly 100%
    assertEqual(App.canvas.fitZoom(1344, 784), 1);
    // a wide but short area: the height decides
    assertEqual(App.canvas.fitZoom(3000, 424), 0.5);
    assertEqual(App.canvas.fitZoom(10, 10), null);
});
