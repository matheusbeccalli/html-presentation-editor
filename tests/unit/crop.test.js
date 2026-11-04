/*
 * crop.test.js - cropping a picture (Phase 5): the crop handles' maths and the
 * true crop (the cut-away pixels are gone from the stored picture). Test
 * pictures are drawn on a canvas here: fake data only.
 */

const CROP_FULL = { left: 100, top: 50, width: 400, height: 200 };

test('crop: a side handle moves only its edge, inside the picture', () => {
    assertEqual(App.crop.moveEdge(CROP_FULL, CROP_FULL, 'w', 40, 99), { left: 140, top: 50, width: 360, height: 200 });
    assertEqual(App.crop.moveEdge(CROP_FULL, CROP_FULL, 's', 99, -50), { left: 100, top: 50, width: 400, height: 150 });
    assertEqual(App.crop.moveEdge(CROP_FULL, CROP_FULL, 'e', 30, 0), CROP_FULL, 'not past the picture\'s edge');
    const cropped = { left: 140, top: 50, width: 360, height: 200 };
    assertEqual(App.crop.moveEdge(cropped, CROP_FULL, 'w', -20, 0), { left: 120, top: 50, width: 380, height: 200 },
        'dragged back out: part of the picture comes back');
});

test('crop: a corner handle moves two edges; the crop never gets smaller than 10 px', () => {
    assertEqual(App.crop.moveEdge(CROP_FULL, CROP_FULL, 'ne', -100, 20), { left: 100, top: 70, width: 300, height: 180 });
    assertEqual(App.crop.moveEdge(CROP_FULL, CROP_FULL, 'nw', 1000, 1000), { left: 490, top: 240, width: 10, height: 10 });
});

test('crop: the crop in slide px becomes a rectangle of the picture\'s own pixels', () => {
    // 400 x 200 on the slide showing 1600 x 800 pixels: 4 pixels per slide px.
    assertEqual(App.crop.sourceRect(CROP_FULL, { left: 150, top: 100, width: 200, height: 100 }, { width: 1600, height: 800 }),
        { x: 200, y: 200, width: 800, height: 400 });
    // A stretched picture: each direction has its own scale.
    assertEqual(App.crop.sourceRect(CROP_FULL, { left: 100, top: 50, width: 200, height: 200 }, { width: 300, height: 300 }),
        { x: 0, y: 0, width: 150, height: 300 });
});

/* A 200 x 100 picture, left half red, right half blue, as a loaded <img>. */
function halvesImage() {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 100;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 100, 100);
    context.fillStyle = '#0000ff';
    context.fillRect(100, 0, 100, 100);
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.src = canvas.toDataURL('image/png');
    });
}

function pixelsOf(src) {
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
            resolve({ width: canvas.width, height: canvas.height, data: data });
        };
        image.src = src;
    });
}

test('crop: a true crop keeps only the pixels inside the crop', async () => {
    const image = await halvesImage();
    // Shown at 400 x 200 on the slide: the right half is x 300 to 500.
    const picture = App.crop.cropImage(image, CROP_FULL, { left: 300, top: 50, width: 200, height: 200 });
    assertEqual([picture.width, picture.height], [100, 100]);
    const pixels = await pixelsOf(picture.src);
    assertEqual([pixels.width, pixels.height], [100, 100], 'the stored picture is only the kept part');
    let red = 0;
    for (let i = 0; i < pixels.data.length; i += 4) {
        if (pixels.data[i] > 128) {
            red += 1;
        }
    }
    assertEqual(red, 0, 'no red pixel left: the cut-away half is gone');
});
