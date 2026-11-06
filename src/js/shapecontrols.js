/*
 * shapecontrols.js - Insert > Shapes: the button and its gallery (SPEC Phase 5).
 *
 * The gallery shows the kinds of shapes.js as icons; picking one runs the
 * insertShape command, which waits for a drag (or a click) on the slide
 * (selection.armInsert). Esc or a press outside closes the gallery.
 *
 * Talks to: shapes.js (the kinds), commands.js, icons.js.
 */

(function () {
    'use strict';

    App.shapeControls = {};

    const el = (...args) => App.util.el(...args);

    let shapesButton = null;
    let gallery = null;

    function iconName(kind) {
        return 'shape' + kind.charAt(0).toUpperCase() + kind.slice(1);
    }

    function closeGallery() {
        if (gallery) {
            gallery.remove();
            gallery = null;
            window.removeEventListener('pointerdown', onOutsidePointerDown, true);
            shapesButton.setAttribute('aria-expanded', 'false');
        }
    }

    function onOutsidePointerDown(event) {
        if (gallery && !gallery.contains(event.target) && !shapesButton.contains(event.target)) {
            closeGallery();
        }
    }

    function onGalleryKey(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            closeGallery();
            shapesButton.focus();
        }
    }

    function openGallery() {
        closeGallery();
        const items = App.shapes.KINDS.map((entry) => {
            const item = el('button', {
                type: 'button', class: 'shape-gallery-item', 'data-shape': entry.kind, title: entry.label, 'aria-label': entry.label,
                onclick: () => {
                    closeGallery();
                    App.commands.run('insertShape', entry.kind);
                },
            });
            item.innerHTML = App.icons.get(iconName(entry.kind));
            return item;
        });
        gallery = el('div', {
            class: 'menu shape-gallery', role: 'dialog', 'aria-label': 'Insert a shape', tabindex: '-1', onkeydown: onGalleryKey,
        }, [el('div', { class: 'table-grid-label' }, ['Shapes']), el('div', { class: 'shape-gallery-grid' }, items)]);
        const rect = shapesButton.getBoundingClientRect();
        gallery.style.left = rect.left + 'px';
        gallery.style.top = rect.bottom + 'px';
        document.body.appendChild(gallery);
        shapesButton.setAttribute('aria-expanded', 'true');
        window.addEventListener('pointerdown', onOutsidePointerDown, true);
        items[0].focus();
    }

    function createShapesButton() {
        shapesButton = el('button', {
            type: 'button', class: 'ribbon-button shapes-button', title: 'Insert a shape', 'aria-label': 'Shapes',
            'aria-haspopup': 'dialog', 'aria-expanded': 'false',
            onclick: () => (gallery ? closeGallery() : openGallery()),
        });
        shapesButton.innerHTML = App.icons.get('shapes');
        shapesButton.appendChild(el('span', { class: 'ribbon-button-label' }, ['Shapes ▾']));
        return shapesButton;
    }

    /* The control named in the ribbon's layout, or null when it is not a shape control. */
    App.shapeControls.create = function create(name) {
        return name === 'insertShape' ? createShapesButton() : null;
    };
})();
