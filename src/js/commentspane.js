/*
 * commentspane.js - the Comments pane on the right and the Review tab's
 * comment commands (SPEC Phase 9). The comments themselves: comments.js.
 *
 * The pane lists the comments of the slide shown, oldest first, each as a
 * card: the author's initials, the date, what it points at ("Slide" or the
 * element, e.g. "Text: Receita e margem"), its text and a delete button.
 * Clicking a card's text edits it in place (Ctrl+Enter or leaving the box
 * keeps the change, Esc drops it). New Comment (Review tab, Ctrl+Alt+M)
 * opens a box at the end of the list for the selected element, or for the
 * slide when nothing is selected; Post (or Ctrl+Enter) adds it.
 *
 * The first comment asks for the author's initials (a box above the text);
 * they are kept in the editor's settings on this computer and can be
 * changed in File > Settings (Phase 9 Q&A: browsers cannot read the Windows
 * user name).
 *
 * Every change (add, edit, delete) is one undo step for the slide (history.js).
 *
 * Markers (step 3): a small yellow bubble over the slide for each thing
 * commented on - at an element's top right corner, at the slide's top left
 * for the slide's own comments (and those whose element was deleted). They
 * are drawn in #overlay, never in the slide (SPEC 3.5), stay the same size on
 * screen at every zoom, and show the number of comments when there are
 * several. Clicking one opens the pane on its first comment. Review > Show
 * Markers hides them (settings.showCommentMarkers). Previous / Next walk
 * through all the deck's comments, slide by slide, wrapping round.
 *
 * Talks to: comments.js (the model), deck.js, history.js, selection.js, text.js
 *           (the box being typed in), settings.js (initials, markers), commands.js,
 *           canvas.js (zoom, for the markers' size).
 */

(function () {
    'use strict';

    App.commentsPane = {};

    const el = (...args) => App.util.el(...args);
    let nodes = null;
    let draft = null;        // the New Comment box while open: { target, slideId }
    let editingId = null;    // the comment whose text is being edited in its card
    let activeId = null;     // the comment last clicked or added (highlighted card)

    App.commentsPane.isOpen = function isOpen() {
        return !!nodes && !nodes.pane.hidden;
    };

    App.commentsPane.open = function open() {
        nodes.pane.hidden = false;
        render();
        App.events.emit('comments-pane-changed', { open: true });
    };

    App.commentsPane.close = function close() {
        draft = null;
        editingId = null;
        nodes.pane.hidden = true;
        App.events.emit('comments-pane-changed', { open: false });
    };

    App.commentsPane.toggle = function toggle() {
        if (App.commentsPane.isOpen()) {
            App.commentsPane.close();
        } else {
            App.commentsPane.open();
        }
    };

    /* The comment card highlighted (and scrolled into view): after a marker click, Previous / Next. */
    App.commentsPane.focusComment = function focusComment(id) {
        activeId = id;
        if (!App.commentsPane.isOpen()) {
            App.commentsPane.open();
        } else {
            render();
        }
        const card = nodes.list.querySelector('[data-comment-id="' + id + '"]');
        if (card) {
            card.scrollIntoView({ block: 'nearest' });
        }
        drawMarkers();
        App.events.emit('comments-active-changed', { id: id });
    };

    App.commentsPane.activeId = function activeIdFn() {
        return activeId;
    };

    // ---------------------------------------------------------------
    // Previous / Next (Review tab)
    // ---------------------------------------------------------------

    App.commentsPane.hasComments = function hasComments() {
        return App.state.hasDeck && App.comments.countIn(App.deck.getDocument()) > 0;
    };

    /* Review > Previous (-1) / Next (+1): show that comment's slide and its card. */
    App.commentsPane.step = function step(direction) {
        const order = App.comments.orderIn(App.deck.getSlides());
        const to = App.comments.step(order, activeId, direction, App.deck.getCurrentIndex());
        if (!to) {
            return;
        }
        if (to.slide !== App.deck.getCurrentIndex()) {
            App.deck.goTo(to.slide);
        }
        App.commentsPane.focusComment(to.id);
    };

    // ---------------------------------------------------------------
    // Markers over the slide
    // ---------------------------------------------------------------

    const MARKER_SIZE = 24;   // screen px at every zoom
    const MARKER_GAP = 7;     // screen px between an element's corner and its marker (past the resize handle)
    const SLIDE_WIDTH = 1280;
    const SLIDE_HEIGHT = 720;

    App.commentsPane.toggleMarkers = function toggleMarkers() {
        App.settings.update({ showCommentMarkers: !App.settings.get().showCommentMarkers });
    };

    function drawMarkers() {
        nodes.markers.replaceChildren();
        const slide = App.state.hasDeck ? App.deck.getCurrentSlide() : null;
        nodes.markers.hidden = !slide || !App.settings.get().showCommentMarkers;
        if (!slide) {
            return;
        }
        const size = MARKER_SIZE / App.canvas.getZoom();   // slide px
        const gap = MARKER_GAP / App.canvas.getZoom();
        App.comments.markersOf(slide).forEach((marker) => {
            const box = App.comments.anchorBox(slide, marker.target);
            // Just right of an element's top right corner, clear of its resize handle (kept on the slide: at the
            // slide's edge it may cover the handle, which then stays on top); the slide's own at its top left.
            const left = box ? Math.min(Math.max(box.left + box.width + gap, 0), SLIDE_WIDTH - size) : size / 3;
            const top = box ? Math.min(Math.max(box.top - size / 2, 0), SLIDE_HEIGHT - size) : size / 3;
            const comments = App.comments.listOf(slide).filter((c) => marker.ids.indexOf(c.id) !== -1);
            const button = el('button', {
                type: 'button', class: 'comment-marker' + (marker.ids.indexOf(activeId) !== -1 ? ' active' : ''),
                'data-target': marker.target || null,
                title: comments.map((c) => c.author + ': ' + c.text).join('\n'),
                'aria-label': marker.ids.length + (marker.ids.length === 1 ? ' comment' : ' comments') + ' on ' +
                    App.comments.targetLabel(slide, marker.target),
                style: 'left:' + left + 'px; top:' + top + 'px',
            }, [marker.ids.length > 1 ? String(marker.ids.length) : '']);
            // Not a press on the slide: no selecting, no dragging (selection.js listens on the overlay).
            button.addEventListener('pointerdown', (event) => event.stopPropagation());
            button.addEventListener('dblclick', (event) => event.stopPropagation());
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                App.commentsPane.focusComment(marker.ids[0]);
            });
            nodes.markers.appendChild(button);
        });
    }

    App.commentsPane.drawMarkers = function drawMarkersFn() {
        if (nodes) {
            drawMarkers();
        }
    };

    /* What New Comment points at: the element being typed in or selected (the first of several), else the slide. */
    function currentTarget() {
        const editing = App.text.editingElement();
        const element = editing ? App.groups.topOf(editing) : App.selection.getElement() || App.selection.getElements()[0];
        return element ? element.getAttribute('data-id') : null;
    }

    /* Review > New Comment (Ctrl+Alt+M): open the pane with an empty comment box. */
    App.commentsPane.newComment = function newComment() {
        const slide = App.deck.getCurrentSlide();
        if (!slide) {
            return;
        }
        App.text.exitEdit();
        draft = { target: currentTarget(), slideId: slide.getAttribute('data-slide-id') };
        editingId = null;
        nodes.pane.hidden = false;
        render();
        App.events.emit('comments-pane-changed', { open: true });
        const first = nodes.list.querySelector('.comment-draft input:not([hidden]), .comment-draft textarea');
        const initials = nodes.list.querySelector('#comment-initials');
        (initials && !initials.value ? initials : nodes.list.querySelector('#comment-draft-text') || first).focus();
    };

    function post() {
        const text = nodes.list.querySelector('#comment-draft-text').value.trim();
        const initialsBox = nodes.list.querySelector('#comment-initials');
        const initials = App.comments.cleanInitials(initialsBox ? initialsBox.value : App.settings.get().authorInitials);
        if (!initials) {
            setDraftHint('Type your initials first (for example MB).');
            initialsBox.focus();
            return;
        }
        if (!text) {
            setDraftHint('Type the comment first.');
            nodes.list.querySelector('#comment-draft-text').focus();
            return;
        }
        if (initials !== App.settings.get().authorInitials) {
            App.settings.update({ authorInitials: initials });
        }
        const slide = App.deck.getSlides().find((s) => s.getAttribute('data-slide-id') === draft.slideId);
        const target = draft.target;
        draft = null;
        if (!slide) {
            render();
            return;
        }
        let id = null;
        App.history.change('New comment', { slideId: slide.getAttribute('data-slide-id') }, () => {
            id = App.comments.add(slide, { target: target, author: initials, date: new Date().toISOString(), text: text });
        });
        App.commentsPane.focusComment(id);
    }

    function setDraftHint(text) {
        const hint = nodes.list.querySelector('.comment-draft-hint');
        if (hint) {
            hint.textContent = text;
        }
    }

    function cancelDraft() {
        draft = null;
        render();
    }

    function slideOf(id) {
        return App.deck.getSlides().find((slide) => App.comments.listOf(slide).some((c) => c.id === id)) || null;
    }

    function saveEdit(id, text) {
        editingId = null;
        const slide = slideOf(id);
        const before = slide && App.comments.listOf(slide).find((c) => c.id === id);
        if (!before || before.text === text || !text.trim()) {
            render();
            return;
        }
        App.history.change('Edit comment', { slideId: slide.getAttribute('data-slide-id') },
            () => App.comments.setText(App.deck.getDocument(), id, text));
    }

    App.commentsPane.deleteComment = function deleteComment(id) {
        const slide = slideOf(id);
        if (!slide) {
            return;
        }
        if (activeId === id) {
            activeId = null;
        }
        App.history.change('Delete comment', { slideId: slide.getAttribute('data-slide-id') },
            () => App.comments.remove(App.deck.getDocument(), id));
    };

    /*
     * Review > Delete All Comments: before sending the deck (SPEC Phase 9). Asks
     * first, saying how many; every slide's comments go in one undo step.
     */
    App.commentsPane.deleteAll = async function deleteAll() {
        const count = App.comments.countIn(App.deck.getDocument());
        if (!count) {
            return;
        }
        const ok = await App.dialogs.confirm({
            title: 'Delete all comments?',
            message: 'Delete all ' + App.ui.commentsText(count) + ' in this deck? Ctrl+Z brings them back. ' +
                '(Exports and Save a Clean Copy leave comments out anyway.)',
            ok: 'Delete All', danger: true,
        });
        if (!ok) {
            return;
        }
        activeId = null;
        editingId = null;
        draft = null;
        App.history.change('Delete all comments', 'deck', () => App.comments.removeAll(App.deck.getDocument()));
        App.ui.setStatus('Deleted ' + App.ui.commentsText(count));
    };

    // ---------------------------------------------------------------
    // Drawing the pane
    // ---------------------------------------------------------------

    function card(slide, comment) {
        const text = el('div', { class: 'comment-text', title: 'Click to edit', tabindex: '0' }, [comment.text]);
        const startEdit = () => {
            editingId = comment.id;
            activeId = comment.id;
            render();
        };
        text.addEventListener('click', startEdit);
        text.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                startEdit();
            }
        });
        const remove = el('button', {
            type: 'button', class: 'comment-delete', title: 'Delete comment', 'aria-label': 'Delete comment',
            onclick: () => App.commentsPane.deleteComment(comment.id),
        });
        remove.innerHTML = App.icons.get('deleteComment');
        const article = el('article', { class: 'comment-card' + (comment.id === activeId ? ' active' : ''), 'data-comment-id': comment.id }, [
            el('header', { class: 'comment-head' }, [
                el('span', { class: 'comment-initials', title: 'Author' }, [comment.author || '?']),
                el('span', { class: 'comment-meta' }, [
                    el('span', { class: 'comment-date' }, [App.comments.dateText(comment.date)]),
                    el('span', { class: 'comment-on' }, [App.comments.targetLabel(slide, comment.target)]),
                ]),
                remove,
            ]),
            text,
        ]);
        article.addEventListener('click', (event) => {
            if (event.target.closest('button, textarea') || activeId === comment.id) {
                return;
            }
            App.commentsPane.focusComment(comment.id);
        });
        if (editingId === comment.id) {
            const box = el('textarea', { class: 'comment-edit', rows: '3', 'aria-label': 'Comment text' });
            box.value = comment.text;
            let done = false;
            const finish = (keep) => {
                if (done) {
                    return;
                }
                done = true;
                if (keep) {
                    saveEdit(comment.id, box.value);
                } else {
                    editingId = null;
                    render();
                }
            };
            box.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    finish(false);
                } else if (event.key === 'Enter' && event.ctrlKey) {
                    event.preventDefault();
                    finish(true);
                }
            });
            box.addEventListener('blur', () => finish(true));
            text.replaceWith(box);   // render() puts the cursor in it once it is on the page
        }
        return article;
    }

    function draftBox(slide) {
        const known = App.settings.get().authorInitials;
        const children = [el('div', { class: 'comment-on' }, ['New comment on ' + App.comments.targetLabel(slide, draft.target)])];
        if (!known) {
            children.push(el('label', { class: 'comment-initials-row' }, [
                'Your initials ',
                el('input', { id: 'comment-initials', type: 'text', maxlength: '4', size: '4', autocomplete: 'off', spellcheck: 'false' }),
                el('span', { class: 'panel-hint' }, [' (kept on this computer; File > Settings)']),
            ]));
        }
        const text = el('textarea', { id: 'comment-draft-text', rows: '3', placeholder: 'Type a comment', 'aria-label': 'New comment' });
        text.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && event.ctrlKey) {
                event.preventDefault();
                post();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                cancelDraft();
            }
        });
        children.push(text);
        children.push(el('p', { class: 'comment-draft-hint panel-hint' }, ['Ctrl+Enter posts it.']));
        children.push(el('div', { class: 'comment-draft-buttons' }, [
            el('button', { type: 'button', class: 'btn btn-primary', id: 'comment-post', onclick: post }, ['Post']),
            el('button', { type: 'button', class: 'btn', onclick: cancelDraft }, ['Cancel']),
        ]));
        return el('div', { class: 'comment-draft' }, children);
    }

    function render() {
        if (!nodes || nodes.pane.hidden) {
            return;
        }
        const slide = App.deck.getCurrentSlide();
        if (draft && (!slide || slide.getAttribute('data-slide-id') !== draft.slideId)) {
            draft = null;   // another slide: the unposted box goes, as an unsent PowerPoint comment does
        }
        const comments = App.comments.listOf(slide);
        // Keep a half-typed new comment while the list is redrawn (an undo, a slide redraw).
        const typed = nodes.list.querySelector('#comment-draft-text');
        const typedInitials = nodes.list.querySelector('#comment-initials');
        const keepText = typed ? typed.value : '';
        const keepInitials = typedInitials ? typedInitials.value : '';
        nodes.list.replaceChildren(...comments.map((comment) => card(slide, comment)));
        if (draft) {
            nodes.list.appendChild(draftBox(slide));
            nodes.list.querySelector('#comment-draft-text').value = keepText;
            if (nodes.list.querySelector('#comment-initials')) {
                nodes.list.querySelector('#comment-initials').value = keepInitials;
            }
        }
        const editBox = nodes.list.querySelector('.comment-edit');
        if (editBox) {
            editBox.focus();
            editBox.setSelectionRange(editBox.value.length, editBox.value.length);
        }
        nodes.empty.hidden = comments.length > 0 || !!draft;
        const total = App.state.hasDeck ? App.comments.countIn(App.deck.getDocument()) : 0;
        nodes.count.textContent = total ? total + ' in the deck' : '';
    }

    App.commentsPane.render = render;

    /* Wiring, called once from App.start(). */
    App.commentsPane.init = function init() {
        nodes = {
            pane: document.getElementById('comments-pane'),
            list: document.getElementById('comments-list'),
            empty: document.getElementById('comments-empty'),
            count: document.getElementById('comments-count'),
            markers: App.util.el('div', { class: 'comment-markers' }),
        };
        // First in the overlay, so the selection box and its handles are drawn over the markers.
        const overlay = document.getElementById('overlay');
        overlay.insertBefore(nodes.markers, overlay.firstChild);
        document.getElementById('comments-new').addEventListener('click', () => App.commands.run('newComment'));
        document.getElementById('comments-close').addEventListener('click', () => App.commentsPane.close());
        App.events.on('deck-loaded', () => {
            draft = null;
            editingId = null;
            activeId = null;
            render();
        });
        ['slide-changed', 'history-changed'].forEach((name) => App.events.on(name, () => {
            drawMarkers();
            if (editingId) {
                return;   // the card being edited keeps its box until it is left
            }
            render();
        }));
        // An element dragged, the zoom or the Show Markers setting changed: the markers move along.
        ['deck-loaded', 'selection-dragged', 'zoom-changed', 'settings-changed'].forEach((name) => App.events.on(name, drawMarkers));
    };
})();
