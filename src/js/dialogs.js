/*
 * dialogs.js - modal dialogs: alerts, confirmations and the import report.
 *
 * Built on the browser's own <dialog> element, which already handles focus,
 * the Esc key and the dark backdrop. Every dialog returns a Promise that
 * resolves with the value of the button the user clicked, so callers can write:
 *
 *     const ok = await App.dialogs.confirm({ title: 'Discard changes?', ... });
 *
 * Talks to: util.js, icons.js, importer.js (report helpers), commands.js
 *           (the "Remove blocked references" button runs a command).
 */

(function () {
    'use strict';

    App.dialogs = {};

    const el = (...args) => App.util.el(...args);

    /*
     * Show a dialog. options = { title, body (Node or text), buttons, wide }
     * buttons = [{ label, value, primary, danger }]. Esc resolves with null.
     */
    App.dialogs.show = function show(options) {
        return new Promise((resolve) => {
            const dialog = el('dialog', { class: 'dialog' + (options.wide ? ' dialog-wide' : '') });
            const body = options.body instanceof Node ? options.body : el('p', {}, [options.body || '']);
            const buttonRow = el('div', { class: 'dialog-buttons' });

            // Resolve straight away on a click (the 'close' event arrives a moment
            // later), and only once, whichever way the dialog is closed.
            let finished = false;
            const finish = (value) => {
                if (finished) {
                    return;
                }
                finished = true;
                if (dialog.open) {
                    dialog.close();
                }
                dialog.remove();
                resolve(value);
            };

            (options.buttons || [{ label: 'OK', value: true, primary: true }]).forEach((button) => {
                const classes = 'btn' + (button.primary ? ' btn-primary' : '') + (button.danger ? ' btn-danger' : '');
                buttonRow.appendChild(el('button', {
                    class: classes, type: 'button', onclick: () => finish(button.value),
                }, [button.label]));
            });

            dialog.append(el('h2', { class: 'dialog-title' }, [options.title]), el('div', { class: 'dialog-body' }, [body]), buttonRow);
            dialog.addEventListener('close', () => finish(null));   // Esc key
            document.body.appendChild(dialog);
            dialog.showModal();
            const primary = buttonRow.querySelector('.btn-primary');
            if (primary) {
                primary.focus();
            }
        });
    };

    App.dialogs.alert = function alert(title, message) {
        return App.dialogs.show({ title: title, body: message });
    };

    /* Resolves true only if the user clicks the OK button. */
    App.dialogs.confirm = async function confirm(options) {
        const value = await App.dialogs.show({
            title: options.title,
            body: options.message,
            buttons: [
                { label: options.cancel || 'Cancel', value: false },
                { label: options.ok || 'OK', value: true, primary: true, danger: !!options.danger },
            ],
        });
        return value === true;
    };

    // ---------------------------------------------------------------
    // Import report (SPEC 3.4)
    // ---------------------------------------------------------------

    function section(title, iconName, lines) {
        const icon = el('span', { class: 'report-icon report-icon-' + iconName });
        icon.innerHTML = App.icons.get(iconName);
        const list = el('ul', { class: 'report-list' });
        lines.forEach((line) => list.appendChild(el('li', {}, [line])));
        return el('section', { class: 'report-section' }, [el('h3', {}, [icon, title]), list]);
    }

    const METHOD_NAMES = {
        'section.slide': '<section class="slide"> elements',
        section: '<section> elements',
        class: 'elements with "slide" in their class name',
        size: 'large 16:9 blocks on the page',
        'whole-page': 'the whole page (no slides found)',
    };

    function summaryLines(report) {
        const lines = [report.slideCount + ' slide' + (report.slideCount === 1 ? '' : 's') +
            ' found, using ' + (METHOD_NAMES[report.method] || report.method) + '.'];
        if (report.isContract) {
            lines.push('The deck already uses the editor\'s format, so its layout was kept exactly as it is.');
        } else {
            lines.push(report.elementsConverted + ' blocks were converted into movable elements with exact positions.');
        }
        if (report.textConverted) {
            lines.push('Text in ' + report.textConverted + (report.textConverted === 1 ? ' box was' : ' boxes were') +
                ' converted to the editor\'s text format: every line is a paragraph with its bullet or number ' +
                'and its level, and the look was kept.');
        }
        if (report.tablesConverted) {
            lines.push(report.tablesConverted + (report.tablesConverted === 1 ? ' table was' : ' tables were') +
                ' converted to the editor\'s table format: every cell is editable text, and the look was kept.');
        }
        if (report.scaledFrom) {
            lines.push('Slides were scaled from ' + report.scaledFrom + ' to 1280×720.');
        }
        if (report.chartsRendered) {
            lines.push(report.chartsRendered + ' chart' + (report.chartsRendered === 1 ? '' : 's') +
                ' had data but no drawing; a placeholder was drawn (full charts arrive in Phase 6).');
        }
        report.fixes.forEach((fix) => lines.push(fix + '.'));
        return lines;
    }

    function removedLines(report) {
        const lines = report.scriptsRemoved.map((script) => script.label);
        if (report.handlersRemoved) {
            lines.push(report.handlersRemoved + ' inline event handler' + (report.handlersRemoved === 1 ? '' : 's') +
                ' (onclick=… or javascript: links).');
        }
        return lines.concat(report.otherRemoved);
    }

    function refLine(ref) {
        const kinds = { stylesheet: 'Stylesheet', import: 'CSS @import', font: 'Web font', 'css-url': 'CSS image', image: 'Image' };
        return (kinds[ref.kind] || ref.kind) + ': ' + ref.url;
    }

    /*
     * Show what the import found and changed. If the deck references remote
     * files (blocked by the browser), offer to remove them (SPEC 2.3).
     */
    App.dialogs.showImportReport = async function showImportReport(report) {
        const body = el('div', { class: 'report' });
        body.appendChild(section('Summary', 'info', summaryLines(report)));

        const removed = removedLines(report);
        if (removed.length) {
            const note = 'Removed for safety. Scripts never run inside the editor; saved decks get the editor\'s own small slide player instead.';
            body.appendChild(section('Removed (' + removed.length + ')', 'check', [note].concat(removed)));
        }
        if (report.remoteRefs.length) {
            const note = 'The browser blocked these internet references, so nothing was downloaded. Text falls back to installed Windows fonts.';
            body.appendChild(section('Blocked (' + report.remoteRefs.length + ')', 'warning',
                [note].concat(report.remoteRefs.map(refLine))));
        }
        if (report.localRefs.length) {
            const note = 'These files sit next to the deck on disk. The editor cannot read them; images must be embedded in the HTML.';
            body.appendChild(section('Missing files (' + report.localRefs.length + ')', 'warning',
                [note].concat(report.localRefs.map(refLine))));
        }
        if (report.warnings.length) {
            body.appendChild(section('Warnings', 'warning', report.warnings));
        }

        const buttons = [{ label: 'OK', value: 'ok', primary: true }];
        if (report.remoteRefs.length) {
            buttons.unshift({ label: 'Remove blocked references', value: 'remove-refs' });
        }
        const choice = await App.dialogs.show({ title: 'Import report', body: body, buttons: buttons, wide: true });
        if (choice === 'remove-refs') {
            App.commands.run('removeBlockedRefs');
        }
        return choice;
    };
})();
