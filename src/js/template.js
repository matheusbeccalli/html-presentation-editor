/*
 * template.js - the built-in blank deck used by File > New (SPEC 4, Phase 1).
 *
 * It follows the deck contract (SPEC 3.3) exactly: theme in :root CSS
 * variables, 1280x720 slides, every element absolutely positioned with a
 * unique data-id and a z-index. Text is in Portuguese because the decks are.
 *
 * Talks to: fileio.js (File > New), importer.js (it is imported like any deck).
 */

App.template = {};

App.template.newDeckHtml = function newDeckHtml() {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="deck-format" content="3">
<title>Nova apresentação</title>
<style>
  :root { --font-heading: Calibri, Arial, sans-serif; --font-body: Calibri, Arial, sans-serif;
          --color-primary: #CC092F; --color-accent: #1F2A44; --color-text: #222; --color-bg: #fff; }
  body  { margin: 0; font-family: var(--font-body); color: var(--color-text); }
  .slide { position: relative; width: 1280px; height: 720px; overflow: hidden; background: var(--color-bg); }
  .el    { position: absolute; box-sizing: border-box; }
  .accent-bar { background: var(--color-primary); }
</style>
</head>
<body>
<section class="slide" data-slide-id="s1" data-layout="title">
  <div class="el accent-bar" data-type="shape" data-id="e1" style="left:64px; top:300px; width:120px; height:8px; z-index:1"></div>
  <div class="el" data-type="text" data-id="e2" style="left:64px; top:180px; width:1152px; height:110px; z-index:2; font-family:var(--font-heading); font-size:36pt; font-weight:bold; line-height:1.15; color:var(--color-accent)"><p data-list="none" data-level="1">Título da apresentação</p></div>
  <div class="el" data-type="text" data-id="e3" style="left:64px; top:332px; width:1152px; height:40px; z-index:3; font-size:16.5pt; line-height:1.4"><p data-list="none" data-level="1">Subtítulo · Data</p></div>
  <aside class="notes"></aside>
</section>
<section class="slide" data-slide-id="s2" data-layout="title-content">
  <div class="el" data-type="text" data-id="e4" style="left:64px; top:48px; width:1152px; height:60px; z-index:1; font-family:var(--font-heading); font-size:25.5pt; font-weight:bold; line-height:1.2; color:var(--color-accent)"><p data-list="none" data-level="1">Título do slide</p></div>
  <div class="el accent-bar" data-type="shape" data-id="e5" style="left:64px; top:116px; width:80px; height:6px; z-index:2"></div>
  <div class="el" data-type="text" data-id="e6" style="left:64px; top:150px; width:1152px; height:500px; z-index:3; font-size:16.5pt; line-height:1.4"><p data-list="bullet" data-level="1">Primeiro ponto</p><p data-list="bullet" data-level="1">Segundo ponto</p><p data-list="bullet" data-level="2">Detalhe do segundo ponto</p><p data-list="bullet" data-level="1">Terceiro ponto</p></div>
  <aside class="notes"></aside>
</section>
</body>
</html>
`;
};
