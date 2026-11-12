/*
 * comments.js - review comments (SPEC Phase 9): sticky notes on a slide or
 * on one element of it, with the author's initials and the date.
 *
 *   <section class="slide"> …
 *     <aside class="comments">
 *       <div class="comment" data-comment-id="c1" data-target="e5" data-author="MB"
 *            data-date="2026-11-11T14:32:00.000Z">Checar a fonte do número</div>
 *     </aside>
 *   </section>
 *
 * Decided in the Phase 9 Q&A:
 *  - The comments are part of the deck file (deck-format 4), so they survive
 *    Save, AutoSave and recovery drafts and reach a colleague who reviews it.
 *  - They are plain text (line breaks kept), no replies, no "resolved" state.
 *  - data-target is the data-id of the element the comment points at; no
 *    data-target = a comment on the slide itself.
 *  - Nothing that is shown or sent carries them: the deck view and a saved
 *    deck hide <aside class="comments"> (deck.js VIEW_CSS, player.css), and
 *    serialize.cleanCopy leaves them out unless asked to keep them (only
 *    Save, AutoSave and drafts ask), so the slide show, print / PDF, slide
 *    pictures, PowerPoint and Save a Clean Copy never include them.
 *
 * This file is the model (read and change the HTML). Each change made by the
 * user goes through history.js in the caller, so it is one undo step.
 *
 * Talks to: util.js (unique ids). Used by serialize.js, normalize.js, importer.js.
 */

(function () {
    'use strict';

    App.comments = {};

    App.comments.SELECTOR = 'aside.comments';

    function boxOf(slide) {
        return slide ? slide.querySelector(':scope > aside.comments') : null;
    }

    function nodesIn(root) {
        return Array.from(root.querySelectorAll('aside.comments > .comment[data-comment-id]'));
    }

    function nodeById(root, id) {
        return nodesIn(root).find((node) => node.getAttribute('data-comment-id') === id) || null;
    }

    function read(node) {
        return {
            id: node.getAttribute('data-comment-id'),
            target: node.getAttribute('data-target') || null,
            author: node.getAttribute('data-author') || '',
            date: node.getAttribute('data-date') || '',
            text: node.textContent,
        };
    }

    /* A slide's comments, in the order they were added: [{ id, target, author, date, text }]. */
    App.comments.listOf = function listOf(slide) {
        const box = boxOf(slide);
        return box ? Array.from(box.querySelectorAll(':scope > .comment[data-comment-id]'), read) : [];
    };

    /* How many comments `root` (a document or a copy of its <html>) holds. */
    App.comments.countIn = function countIn(root) {
        return nodesIn(root).length;
    };

    /*
     * Add a comment to `slide`: { target (element id or none), author, date (ISO text), text }.
     * Returns its id, unused anywhere in the deck. The slide's comments box is
     * made at the end of the slide if it has none.
     */
    App.comments.add = function add(slide, comment) {
        const doc = slide.ownerDocument;
        const used = new Set(nodesIn(doc).map((node) => node.getAttribute('data-comment-id')));
        const id = App.util.uniqueId('c', used);
        let box = boxOf(slide);
        if (!box) {
            box = doc.createElement('aside');
            box.setAttribute('class', 'comments');
            slide.appendChild(box);
        }
        const node = doc.createElement('div');
        node.setAttribute('class', 'comment');
        node.setAttribute('data-comment-id', id);
        if (comment.target) {
            node.setAttribute('data-target', comment.target);
        }
        node.setAttribute('data-author', comment.author || '');
        node.setAttribute('data-date', comment.date || '');
        node.textContent = comment.text || '';   // text, never markup
        box.appendChild(node);
        return id;
    };

    /* Change a comment's text. False when there is no such comment. */
    App.comments.setText = function setText(root, id, text) {
        const node = nodeById(root, id);
        if (node) {
            node.textContent = text;
        }
        return !!node;
    };

    /* Remove one comment; a slide's last comment takes the empty box along. False when there is no such comment. */
    App.comments.remove = function remove(root, id) {
        const node = nodeById(root, id);
        if (!node) {
            return false;
        }
        const box = node.parentNode;
        node.remove();
        if (!box.querySelector('.comment')) {
            box.remove();
        }
        return true;
    };

    /* Remove every comment in `root` ("Delete All Comments", a clean copy). Returns how many there were. */
    App.comments.removeAll = function removeAll(root) {
        const count = App.comments.countIn(root);
        root.querySelectorAll(App.comments.SELECTOR).forEach((box) => box.remove());
        return count;
    };
})();
