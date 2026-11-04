/*
 * images.test.js - pictures (Phase 5): sizes, compression on insert (longest
 * side 1920 px; the smaller of PNG and JPEG 0.85; transparent stays PNG) and
 * the picture element. Test pictures are drawn on a canvas here: fake data only.
 */

/* A canvas `width` x `height`, drawn by draw(context), as a Blob of `type` (quality for JPEG). */
function drawnBlob(width, height, draw, type, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext('2d'));
    return new Promise((resolve) => canvas.toBlob(resolve, type || 'image/png', quality));
}

/* A photo-like picture: random colour in every 4 x 4 block (JPEG compresses it far better than PNG). */
function noise(context) {
    const { width, height } = context.canvas;
    for (let y = 0; y < height; y += 4) {
        for (let x = 0; x < width; x += 4) {
            context.fillStyle = 'rgb(' + [0, 1, 2].map(() => Math.floor(Math.random() * 256)).join(',') + ')';
            context.fillRect(x, y, 4, 4);
        }
    }
}

/* A logo-like picture: flat colours and text (PNG keeps it smaller and sharp). */
function logo(context) {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
    context.fillStyle = '#1F2A44';
    context.fillRect(10, 10, 80, 80);
    context.font = 'bold 40px sans-serif';
    context.fillText('ACME', 110, 65);
}

function imageSize(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
        image.onerror = reject;
        image.src = src;
    });
}

test('images: fitSize keeps the proportions with the longest side at most the limit', () => {
    assertEqual(App.images.fitSize(4000, 1000, 1920), { width: 1920, height: 480 });
    assertEqual(App.images.fitSize(1000, 3000, 1920), { width: 640, height: 1920 });
    assertEqual(App.images.fitSize(800, 600, 1920), { width: 800, height: 600 });
});

test('images: a new picture is centred on the slide at its own size, smaller if it does not fit', () => {
    assertEqual(App.images.placeRect(400, 200), { left: 440, top: 260, width: 400, height: 200 });
    assertEqual(App.images.placeRect(3000, 1000), { left: 64, top: 168, width: 1152, height: 384 });
    assertEqual(App.images.placeRect(500, 1500), { left: 541.33, top: 64, width: 197.33, height: 592 });
});

test('images: a big photo becomes a JPEG with its longest side 1920 px', async () => {
    const picture = await App.images.compress(await drawnBlob(4000, 1000, noise));
    assertEqual([picture.width, picture.height, picture.type], [1920, 480, 'image/jpeg']);
    assert(picture.src.startsWith('data:image/jpeg;base64,'), picture.src.slice(0, 30));
    assertEqual(await imageSize(picture.src), [1920, 480]);
});

test('images: a logo or screenshot with flat colours stays PNG when that is smaller', async () => {
    const picture = await App.images.compress(await drawnBlob(300, 100, logo));
    assertEqual(picture.type, 'image/png');
    assertEqual([picture.width, picture.height], [300, 100]);
});

test('images: a picture with transparency always stays PNG, transparent', async () => {
    const picture = await App.images.compress(await drawnBlob(1200, 800, (context) => {
        noise(context);
        context.clearRect(0, 0, 200, 200);
    }));
    assertEqual(picture.type, 'image/png');
    const pixel = await new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            canvas.getContext('2d').drawImage(image, 0, 0);
            resolve(canvas.getContext('2d').getImageData(5, 5, 1, 1).data[3]);
        };
        image.src = picture.src;
    });
    assertEqual(pixel, 0, 'the corner is still transparent');
});

test('images: a file already smaller than both re-encodings is kept as it is', async () => {
    const original = await drawnBlob(600, 400, noise, 'image/jpeg', 0.3);
    const picture = await App.images.compress(original);
    assertEqual(picture.type, 'image/jpeg');
    assertEqual(picture.src, await App.images.dataUrlOf(original));
});

test('images: an SVG picture is kept as it is (it stays sharp at any size)', async () => {
    const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#C00000"/></svg>'],
        { type: 'image/svg+xml' });
    const picture = await App.images.compress(svg);
    assertEqual([picture.type, picture.width, picture.height], ['image/svg+xml', 120, 40]);
    assert(picture.src.startsWith('data:image/svg+xml;base64,'), picture.src.slice(0, 30));
});

test('images: a file the browser cannot show is refused with a plain message', async () => {
    let message = '';
    try {
        await App.images.compress(new Blob(['not a picture'], { type: 'image/tiff' }));
    } catch (error) {
        message = error.message;
    }
    assertIncludes(message, 'cannot be shown');
});

test('images: the picture element follows the deck contract', () => {
    const doc = parseDoc('<section class="slide"></section>');
    const element = App.images.createImage(doc, { src: 'data:image/png;base64,AAAA', width: 400, height: 200 },
        { left: 440, top: 260, width: 400, height: 200 }, 'e9');
    assertEqual(element.outerHTML, '<img class="el" data-type="image" data-id="e9" alt="" ' +
        'style="left: 440px; top: 260px; width: 400px; height: 200px;" src="data:image/png;base64,AAAA">');
});
