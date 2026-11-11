"""
Phase 6 hand checks replayed literally in Edge: real clicks, drags and keys, one assertion per step.
Each test follows its FEATURES.md hand check from start to end (quoted in the docstring). The charts are
asserted on what is drawn (the SVG's rects, paths and texts, their computed colours, opacity, dashes and
positions), so a chart drawn wrong fails the test.
"""

import re

import e2e_test as e2e
from e2e_test import Editor, check, drag, element_rect, slide_to_screen, wait_until

PREFIX = "gap-p6-"

# Every node matching `selector` inside a chart's drawing: its attributes, text (and tspans), computed paint and
# its box in the slide's own pixels (the deck frame's coordinates, not the editor's zoom).
NODES = """([id, selector]) => {
    const figure = App.deck.getDocument().querySelector('[data-id="' + id + '"]');
    if (!figure) { return []; }
    return Array.from(figure.querySelectorAll(':scope > svg ' + selector), (node) => {
        const style = node.ownerDocument.defaultView.getComputedStyle(node);
        const attrs = {};
        Array.from(node.attributes).forEach((a) => { attrs[a.name] = a.value; });
        const box = node.getBoundingClientRect();
        return { attrs: attrs, text: node.textContent, tspans: Array.from(node.querySelectorAll('tspan'), (t) => t.textContent),
                 tspanYs: Array.from(node.querySelectorAll('tspan'), (t) => t.getBoundingClientRect().top),
                 fill: style.fill, fillOpacity: style.fillOpacity, stroke: style.stroke, strokeWidth: style.strokeWidth,
                 dash: style.strokeDasharray, box: { x: box.left, y: box.top, width: box.width, height: box.height } };
    });
}"""
SVG_INFO = """id => { const svg = App.deck.getDocument().querySelector('[data-id="' + id + '"] > svg');
    if (!svg) { return null; }
    const box = svg.getBoundingClientRect();
    return { cls: svg.getAttribute('class'), width: svg.getAttribute('width'), height: svg.getAttribute('height'),
             viewBox: svg.getAttribute('viewBox'), placeholder: svg.hasAttribute('data-chart-placeholder'),
             shownWidth: box.width, shownHeight: box.height,
             tags: [svg.localName].concat(Array.from(svg.querySelectorAll('*'), (n) => n.localName)) }; }"""
CHART_DATA = "id => JSON.parse(App.deck.getDocument().querySelector('[data-id=\"' + id + '\"] script.chart-data').textContent)"
DECK_VAR = "name => getComputedStyle(App.deck.getDocument().documentElement).getPropertyValue(name).trim()"
FIGURE_OF_TYPE = """type => { const figure = Array.from(App.deck.getCurrentSlide().querySelectorAll('[data-type="chart"]'))
    .find((f) => JSON.parse(f.querySelector('script.chart-data').textContent).type === type);
    return figure ? figure.getAttribute('data-id') : null; }"""


def nodes(page, id_, selector):
    return page.evaluate(NODES, [id_, selector])


def num(node, name):
    return float(node["attrs"][name])


def texts(page, id_, selector):
    return [node["text"] for node in nodes(page, id_, selector)]


def rgb(css):
    """'rgb(1, 2, 3)' or '#010203' as (1, 2, 3)."""
    css = css.strip()
    if css.startswith("#"):
        return tuple(int(css[i:i + 2], 16) for i in (1, 3, 5))
    found = re.findall(r"[\d.]+", css)
    return tuple(round(float(v)) for v in found[:3])


def centre_x(rect):
    return num(rect, "x") + num(rect, "width") / 2


def bottom(rect):
    return num(rect, "y") + num(rect, "height")


def right(rect):
    return num(rect, "x") + num(rect, "width")


def path_points(d):
    """The (x, y) points of a path made of M / L commands."""
    values = [float(v) for v in re.findall(r"-?[\d.]+", d)]
    return list(zip(values[0::2], values[1::2]))


def label_on(labels, x, content, tolerance=0.6):
    """The labels reading `content` whose x is `x` (labels are matched to their bar by position, not by order)."""
    return [label for label in labels if label["text"] == content and abs(num(label, "x") - x) <= tolerance]


def _centre(page, selector):
    box = page.locator(selector).bounding_box()
    return [box["x"] + box["width"] / 2, box["y"] + box["height"] / 2]


def _go_to_slide(page, index):
    page.click(f".thumb[data-index='{index}']")
    wait_until(page, f"App.deck.getCurrentIndex() === {index}")


def _drag_right_edge(page, pixels):
    """Drag the selected element's right-edge handle `pixels` slide pixels (negative: to the left)."""
    side = page.locator("#overlay .selection-handle[data-handle='e']").bounding_box()
    zoom = page.evaluate("App.canvas.getZoom()")
    drag(page, (side["x"] + 4, side["y"] + 4), (side["x"] + 4 + pixels * zoom, side["y"] + 4))


def _boxes(rects):
    return [(num(r, "x"), num(r, "y"), num(r, "width"), num(r, "height")) for r in rects]


# ----------------------------------------------------------------------
# 1. Charts drawn
# ----------------------------------------------------------------------

def test_gap_p6_charts_drawn(browser):
    """Charts drawn: after `python3 tests/run_tests.py`, open `tests/output/charts-deck.html` (made by the tests, fake
    numbers): the report says 2 charts were drawn. Slide 4: columns for 2022-2025E with the 2025E pair lighter and
    dashed, numbers on top as 1.234, a legend at the bottom; a horizontal bar chart beside it. Drag the column chart's
    right edge: it is drawn again narrower, the text stays the same size; Ctrl+Z"""
    # The same deck the twin (test_chart_rendering) writes, under our own name.
    revenue = {"version": 1, "type": "column", "categories": ["2022", "2023", "2024", "2025E"],
               "estimates": [False, False, False, True],
               "series": [{"name": "Receita (R$ mn)", "values": [410, 498, 587, 702]},
                          {"name": "EBITDA (R$ mn)", "values": [74, 100, 123, 161]}],
               "options": {"title": "Receita e EBITDA", "dataLabels": True, "locale": "pt-BR"}}
    ranking = {"version": 1, "type": "bar", "categories": ["Alfa", "Beta", "Gama"],
               "series": [{"name": "EV/EBITDA", "values": [9.8, 7.5, 11.2]}], "options": {"title": "Múltiplos"}}
    deck = e2e.chart_deck(PREFIX + "charts-deck.html", [("e12", 64, 130, 700, 440, revenue), ("e20", 800, 290, 420, 280, ranking)])
    editor = Editor(browser)
    editor.open(deck)
    page = editor.page

    # The report says 2 charts were drawn.
    report = editor.report_dialog_text() or ""
    check("2 charts had data but no drawing" in report, f"the report says 2 charts were drawn: {report!r}")
    editor.close_dialog_if_open()

    # Slide 4: columns for 2022-2025E.
    _go_to_slide(page, 3)
    check(page.evaluate(SVG_INFO, "e12")["cls"] == "chart-svg", "the column chart is drawn by the editor")
    check(texts(page, "e12", ".chart-category-label") == ["2022", "2023", "2024", "2025E"], "the years 2022-2025E under the columns")
    series = [nodes(page, "e12", f"g.chart-series[data-series='{s}'] rect.chart-bar") for s in (0, 1)]
    check(len(series[0]) == 4 and len(series[1]) == 4, f"two series of four columns: {[len(s) for s in series]}")
    floor = {round(bottom(r), 1) for r in series[0] + series[1]}
    check(len(floor) == 1, f"columns standing on one baseline: {floor}")
    for values, rects in zip([[410, 498, 587, 702], [74, 100, 123, 161]], series):
        for value, rect in zip(values, rects):
            check(abs(num(rect, "height") / num(series[0][0], "height") - value / 410) < 0.01,
                  f"column heights follow the values: {value} -> {num(rect, 'height')}")
        check(all(num(rects[i], "x") < num(rects[i + 1], "x") for i in range(3)), "the years left to right")

    # The 2025E pair lighter and dashed; the actual years solid.
    for s, rects in enumerate(series):
        for i, rect in enumerate(rects):
            if i == 3:
                check(rect["fillOpacity"] == "0.5" and rect["dash"] not in ("none", "") and rgb(rect["stroke"]) == rgb(rect["fill"]),
                      f"series {s} 2025E: lighter and dashed: {rect['fillOpacity']} {rect['dash']}")
            else:
                check(rect["fillOpacity"] == "1" and rect["dash"] in ("none", ""), f"series {s} year {i}: solid: {rect['fillOpacity']} {rect['dash']}")
    check(abs(right(series[0][3]) - num(series[1][3], "x")) < 0.6, "the two 2025E columns stand side by side (a pair)")

    # Numbers on top, written the pt-BR way (no number here reaches 1.000: see the report).
    labels = nodes(page, "e12", ".chart-data-label")
    for values, rects in zip([[410, 498, 587, 702], [74, 100, 123, 161]], series):
        for value, rect in zip(values, rects):
            found = label_on(labels, centre_x(rect), str(value))
            check(len(found) == 1 and num(found[0], "y") < num(rect, "y"), f"{value} written on top of its column: {found}")

    # A legend at the bottom: under the year names, keys in the series' colours.
    legend = nodes(page, "e12", ".chart-legend-label")
    check([node["text"] for node in legend] == ["Receita (R$ mn)", "EBITDA (R$ mn)"], f"the legend: {[n['text'] for n in legend]}")
    lowest_year = max(num(node, "y") for node in nodes(page, "e12", ".chart-category-label"))
    check(all(num(node, "y") > lowest_year for node in legend) and num(legend[0], "y") == num(legend[1], "y")
          and num(legend[0], "y") > 440 * 0.85, f"the legend in a row at the bottom: {[num(n, 'y') for n in legend]} (years at {lowest_year})")
    keys = nodes(page, "e12", ".chart-legend rect")
    check([rgb(k["fill"]) for k in keys] == [rgb(series[0][0]["fill"]), rgb(series[1][0]["fill"])], "the legend keys in the series' colours")

    # A horizontal bar chart beside it.
    bars = nodes(page, "e20", "rect.chart-bar")
    check(len(bars) == 3, f"three bars: {len(bars)}")
    check(len({num(b, "x") for b in bars}) == 1 and len({num(b, "height") for b in bars}) == 1, "bars from one left edge, all as thick")
    check(all(abs(num(b, "width") / num(bars[0], "width") - v / 9.8) < 0.01 for b, v in zip(bars, [9.8, 7.5, 11.2])),
          f"bar lengths follow the values: {[num(b, 'width') for b in bars]}")
    check(num(bars[0], "y") < num(bars[1], "y") < num(bars[2], "y"), "one bar under the other")
    check(texts(page, "e20", ".chart-category-label") == ["Alfa", "Beta", "Gama"], "the names at the left")
    columns_box, bars_box = element_rect(page, "e12"), element_rect(page, "e20")
    check(bars_box["left"] >= columns_box["left"] + columns_box["width"] and bars_box["top"] < columns_box["top"] + columns_box["height"],
          f"beside the column chart: {columns_box} / {bars_box}")
    page.screenshot(path=str(e2e.OUTPUT / (PREFIX + "charts-drawn.png")))

    # Drag the column chart's right edge: drawn again narrower, the text the same size.
    fonts = [(n["attrs"].get("class"), n["attrs"].get("font-size"), round(n["box"]["height"], 1)) for n in nodes(page, "e12", "text")]
    page.mouse.click(*slide_to_screen(page, 300, 300))
    check(page.evaluate("App.selection.selectedId()") == "e12" and page.is_visible("#overlay .selection-box"), "the column chart selected")
    _drag_right_edge(page, -200)
    svg = page.evaluate(SVG_INFO, "e12")
    width = element_rect(page, "e12")["width"]
    check(round(width) == 500 and svg["width"] == "500" and svg["viewBox"] == "0 0 500 440", f"drawn again at the new width: {width} {svg}")
    check(abs(svg["shownWidth"] - 500) < 1 and abs(svg["shownHeight"] - 440) < 1, f"not stretched: {svg['shownWidth']} x {svg['shownHeight']}")
    narrower = [nodes(page, "e12", f"g.chart-series[data-series='{s}'] rect.chart-bar") for s in (0, 1)]
    check(all(num(a, "width") < num(b, "width") and abs(num(a, "height") - num(b, "height")) < 0.01
              for a, b in zip(narrower[0] + narrower[1], series[0] + series[1])), "narrower columns, the same heights")
    after = [(n["attrs"].get("class"), n["attrs"].get("font-size"), round(n["box"]["height"], 1)) for n in nodes(page, "e12", "text")]
    check(after == fonts, f"the text keeps its size: {fonts} -> {after}")
    page.screenshot(path=str(e2e.OUTPUT / (PREFIX + "charts-narrower.png")))

    # Ctrl+Z: as it was.
    page.keyboard.press("Control+z")
    check(element_rect(page, "e12")["width"] == 700 and page.evaluate(SVG_INFO, "e12")["width"] == "700", "Ctrl+Z: 700 wide again")
    check(_boxes(nodes(page, "e12", "rect.chart-bar")) == _boxes(series[0] + series[1]), "Ctrl+Z: the columns as they were")

    # PROXY for "numbers on top as 1.234": no number of this deck reaches 1.000, so one is typed in the grid
    # (double-click the chart, 1234 over 410): drawn on top of its column as 1.234; then Ctrl+Z.
    page.mouse.dblclick(*slide_to_screen(page, 300, 300))
    check(page.is_visible("#chart-data-panel"), "double-click: the chart's grid")
    page.click("#chart-data-grid input.cell[data-row='0'][data-col='0']")
    page.keyboard.type("1234")
    first = nodes(page, "e12", "g.chart-series[data-series='0'] rect.chart-bar")[0]
    found = label_on(nodes(page, "e12", ".chart-data-label"), centre_x(first), "1.234")
    check(len(found) == 1 and num(found[0], "y") < num(first, "y"), f"1234 written on top as 1.234: {texts(page, 'e12', '.chart-data-label')}")
    page.click("#chart-data-close")
    page.keyboard.press("Control+z")
    check(_boxes(nodes(page, "e12", "rect.chart-bar")) == _boxes(series[0] + series[1]), "Ctrl+Z: 410 again")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# 2. Lines, combo, donut
# ----------------------------------------------------------------------

def test_gap_p6_lines_combo_donut(browser):
    """Lines, combo, donut: open `tests/output/charts-step2.html` (made by the tests). Slide 4: a combo with revenue
    columns (numbers inside their base) and the margin as a red line with % on a right-hand axis, dashed into 2025E; a
    line chart; a donut with 55% / 30% / 15% and its legend on the right. Open `samples/copilot-appendix-a-deck.html`:
    its combo chart is drawn (the waterfall is still grey until the next step). Open `samples/contract-deck.html`,
    slide 4: the chart looks as before; resize it: now the editor draws it"""
    margin = {"version": 1, "type": "line", "categories": ["2022", "2023", "2024", "2025E"],
              "estimates": [False, False, False, True],
              "series": [{"name": "Margem EBITDA", "values": [0.18, 0.2, 0.21, 0.23], "format": "percent"}],
              "options": {"title": "Margem", "dataLabels": True}}
    combo = {"version": 1, "type": "combo", "categories": ["2022", "2023", "2024", "2025E"],
             "estimates": [False, False, False, True],
             "series": [{"name": "Receita (R$ mn)", "type": "column", "axis": "primary", "values": [410, 498, 587, 702]},
                        {"name": "Margem EBITDA", "type": "line", "axis": "secondary", "values": [0.18, 0.2, 0.21, 0.23],
                         "format": "percent"}],
             "options": {"title": "Receita e margem", "legend": "bottom", "dataLabels": True, "locale": "pt-BR"}}
    owners = {"version": 1, "type": "donut", "categories": ["Fundo A", "Fundadores", "Outros"],
              "series": [{"name": "Participação", "values": [55, 30, 15]}], "options": {"title": "Acionistas"}}
    deck = e2e.chart_deck(PREFIX + "charts-step2.html", [("e12", 40, 130, 640, 420, combo), ("e20", 700, 260, 540, 170, margin),
                                                          ("e21", 700, 440, 540, 200, owners)])
    editor = Editor(browser)
    editor.open(deck)
    editor.close_dialog_if_open()
    page = editor.page
    _go_to_slide(page, 3)

    # The combo: revenue columns with their numbers inside the base (white; dark in the lighter 2025E).
    columns = nodes(page, "e12", "rect.chart-bar")
    check(len(columns) == 4, f"four revenue columns: {len(columns)}")
    labels = nodes(page, "e12", ".chart-data-label")
    for i, (value, rect) in enumerate(zip([410, 498, 587, 702], columns)):
        found = label_on(labels, centre_x(rect), str(value))
        check(len(found) == 1, f"{value} on its column: {found}")
        y = num(found[0], "y")
        check(num(rect, "y") + num(rect, "height") * 0.75 < y <= bottom(rect), f"{value} inside the column's base: {y} in {num(rect, 'y')}..{bottom(rect)}")
        check(rgb(found[0]["fill"]) == ((64, 64, 64) if i == 3 else (255, 255, 255)), f"{value}: white (dark in 2025E): {found[0]['fill']}")

    # The margin as a red line (the deck's primary red), with % on a right-hand axis, dashed into 2025E.
    primary = rgb(page.evaluate(DECK_VAR, "--color-primary"))
    solid = nodes(page, "e12", "path.chart-line")
    dashed = nodes(page, "e12", "path.chart-line-estimate")
    check(len(solid) == 1 and len(dashed) == 1, f"one line, its 2025E part apart: {len(solid)} {len(dashed)}")
    colour = rgb(solid[0]["stroke"])
    check(colour == primary and colour[0] > 150 and colour[1] < 80 and colour[2] < 80, f"the margin line is red: {solid[0]['stroke']} (primary {primary})")
    centres = [centre_x(rect) for rect in columns]
    points = path_points(solid[0]["attrs"]["d"])
    check([round(x, 1) for x, y in points] == [round(x, 1) for x in centres[:3]] and solid[0]["dash"] in ("none", ""),
          f"solid from 2022 to 2024: {points}")
    estimate = path_points(dashed[0]["attrs"]["d"])
    check([round(x, 1) for x, y in estimate] == [round(centres[2], 1), round(centres[3], 1)] and dashed[0]["dash"] not in ("none", "")
          and rgb(dashed[0]["stroke"]) == primary, f"dashed from 2024 into 2025E: {estimate} {dashed[0]['dash']}")
    right_axis = nodes(page, "e12", ".chart-value-label-secondary")
    check(len(right_axis) >= 2 and all(node["text"].endswith("%") for node in right_axis), f"% on the second axis: {[n['text'] for n in right_axis]}")
    check(min(num(node, "x") for node in right_axis) > max(right(rect) for rect in columns)
          and all(node["attrs"].get("text-anchor") == "start" for node in right_axis), "the % axis on the right, past the columns")
    left_axis = nodes(page, "e12", ".chart-value-label")
    check(max(num(node, "x") for node in left_axis) < min(num(rect, "x") for rect in columns), "the revenue axis on the left")
    check([n["text"] for n in labels if n["text"].endswith("%")] == ["18%", "20%", "21%", "23%"], "the margin's numbers in %")

    # A line chart.
    check(len(nodes(page, "e20", "rect.chart-bar")) == 0 and len(nodes(page, "e20", "path.chart-line")) == 1
          and len(nodes(page, "e20", "circle.chart-marker")) == 4, "a line chart: a line, four points, no columns")
    check(nodes(page, "e20", "path.chart-line-estimate")[0]["dash"] not in ("none", ""), "the line chart dashed into 2025E too")

    # A donut with 55% / 30% / 15% and its legend on the right.
    slices = nodes(page, "e21", "path.chart-slice")
    check(len(slices) == 3 and all(s["attrs"]["d"].count("A") == 2 for s in slices), "three slices of a ring (outer and inner arcs)")
    check(texts(page, "e21", ".chart-data-label") == ["55%", "30%", "15%"], f"55% / 30% / 15%: {texts(page, 'e21', '.chart-data-label')}")
    legend = nodes(page, "e21", ".chart-legend-label")
    ring_right = max(s["box"]["x"] + s["box"]["width"] for s in slices)
    check([n["text"] for n in legend] == ["Fundo A", "Fundadores", "Outros"], "the legend names the slices")
    check(all(n["box"]["x"] > ring_right for n in legend) and len({num(n, "x") for n in legend}) == 1
          and num(legend[0], "y") < num(legend[1], "y") < num(legend[2], "y"), "the legend in a column on the right of the ring")
    page.evaluate("document.getElementById('format-pane').scrollTop = 0")
    page.screenshot(path=str(e2e.OUTPUT / (PREFIX + "line-combo-donut.png")))
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()

    # The Copilot sample: its combo chart is drawn (slide 3).
    editor = Editor(browser)
    editor.open(e2e.APPENDIX_A)
    editor.close_dialog_if_open()
    page = editor.page
    _go_to_slide(page, 2)
    combo_id = page.evaluate(FIGURE_OF_TYPE, "combo")
    svg = page.evaluate(SVG_INFO, combo_id)
    check(svg["cls"] == "chart-svg" and not svg["placeholder"], f"the sample's combo drawn by the editor: {svg['cls']}")
    check(len(nodes(page, combo_id, "rect.chart-bar")) == 4 and len(nodes(page, combo_id, "path.chart-line")) == 1
          and len(nodes(page, combo_id, ".chart-value-label-secondary")) >= 2, "its columns, its margin line on a right-hand axis")
    page.screenshot(path=str(e2e.OUTPUT / (PREFIX + "appendix-combo.png")))
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()

    # The contract deck, slide 4: its own drawing kept as in the file (PROXY for "looks as before"); resized: drawn by the editor.
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    _go_to_slide(page, 3)
    source = e2e.CONTRACT.read_text(encoding="utf-8")
    start = source.index("<svg", source.index('data-id="e12"'))
    file_tags = re.findall(r"<([a-zA-Z]+)", source[start:source.index("</svg>", start)])
    own = page.evaluate(SVG_INFO, "e12")
    check(own["cls"] is None and own["tags"] == file_tags, f"the deck's own drawing, as in the file: {own['cls']} {own['tags'][:6]}")
    page.mouse.click(*slide_to_screen(page, 300, 300))
    check(page.evaluate("App.selection.selectedId()") == "e12", "the chart selected")
    _drag_right_edge(page, -60)
    drawn = page.evaluate(SVG_INFO, "e12")
    width = round(element_rect(page, "e12")["width"])
    check(drawn["cls"] == "chart-svg" and width < 760 and drawn["width"] == str(width), f"resized: drawn by the editor at {width}: {drawn['cls']} {drawn['width']}")
    check(len(nodes(page, "e12", "rect.chart-bar")) == 4 and len(nodes(page, "e12", "path.chart-line")) == 1, "its columns and margin line")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# 3. Waterfall
# ----------------------------------------------------------------------

def test_gap_p6_waterfall(browser):
    """Waterfall: open `samples/copilot-appendix-a-deck.html`, slide 2: the EBITDA bridge is drawn: EBITDA 2024 and
    2026E in the deck's accent, Novos parques and Eficiência green, Custos corporativos red and hanging down, thin
    connector lines between the bars, labels +95, +30, -25"""
    editor = Editor(browser)
    editor.open(e2e.APPENDIX_A)
    editor.close_dialog_if_open()
    page = editor.page
    _go_to_slide(page, 1)
    bridge = page.evaluate(FIGURE_OF_TYPE, "waterfall")
    svg = page.evaluate(SVG_INFO, bridge)
    check(svg["cls"] == "chart-svg" and not svg["placeholder"], "the EBITDA bridge is drawn")
    names = [" ".join(n["tspans"]) if n["tspans"] else n["text"] for n in nodes(page, bridge, ".chart-category-label")]
    check(names == ["EBITDA 2024", "Novos parques", "Eficiência", "Custos corporativos", "EBITDA 2026E"], f"the bars' names: {names}")
    bars = nodes(page, bridge, "rect.chart-bar")
    check(len(bars) == 5, f"five bars: {len(bars)}")
    check(all(abs(centre_x(bar) - num(label, "x")) < 0.6 for bar, label in zip(bars, nodes(page, bridge, ".chart-category-label"))),
          "each bar over its name")

    # Ends in the deck's accent; the increases green; the decrease red.
    accent = rgb(page.evaluate(DECK_VAR, "--color-accent"))
    fills = [rgb(bar["fill"]) for bar in bars]
    check(fills[0] == accent and fills[4] == accent, f"EBITDA 2024 and 2026E in the deck's accent {accent}: {fills}")
    check(fills[1] == fills[2] == (60, 157, 93) and fills[1][1] > fills[1][0] and fills[1][1] > fills[1][2], f"increases green: {fills[1:3]}")
    check(fills[3] == (217, 83, 79) and fills[3][0] > 150 and fills[3][1] < 100, f"the decrease red: {fills[3]}")

    # Custos corporativos hanging down: its top at the level Eficiência reached, its bottom lower, above the axis.
    zero = nodes(page, bridge, "line.chart-axis-line")[0]
    check(abs(num(bars[3], "y") - num(bars[2], "y")) < 0.01 and bottom(bars[3]) > num(bars[3], "y")
          and bottom(bars[3]) < num(zero, "y1"), f"the decrease hangs down from Eficiência's top: {_boxes(bars)}")
    check(abs(bottom(bars[1]) - num(bars[0], "y")) < 0.01 and abs(bottom(bars[2]) - num(bars[1], "y")) < 0.01,
          "Novos parques floats from EBITDA 2024's top, Eficiência from Novos parques' top")
    check(abs(num(bars[4], "y") - bottom(bars[3])) < 0.01 and abs(bottom(bars[4]) - bottom(bars[0])) < 0.01,
          "EBITDA 2026E stands on the axis up to where the decrease ended")

    # Thin connector lines between the bars, at each level.
    connectors = nodes(page, bridge, "line.chart-connector")
    check(len(connectors) == 4, f"four connectors: {len(connectors)}")
    levels = [num(bars[0], "y"), num(bars[1], "y"), num(bars[2], "y"), bottom(bars[3])]
    for i, line in enumerate(connectors):
        check(num(line, "y1") == num(line, "y2") and abs(num(line, "y1") - levels[i]) < 0.01, f"connector {i} level with its bar's end: {line['attrs']}")
        check(abs(num(line, "x1") - right(bars[i])) < 0.01 and abs(num(line, "x2") - num(bars[i + 1], "x")) < 0.01,
              f"connector {i} from bar to bar: {line['attrs']}")
        check(line["strokeWidth"] == "1px" and line["dash"] in ("none", ""), f"connector {i} thin: {line['strokeWidth']}")

    # Labels +95, +30, -25 (each on its own bar; -25 under the hanging bar).
    labels = nodes(page, bridge, ".chart-data-label")
    for bar, content in zip(bars, ["240", "+95", "+30", "-25", "340"]):
        found = label_on(labels, centre_x(bar), content)
        check(len(found) == 1, f"{content} on its bar: {[l['text'] for l in labels]}")
        if content == "-25":
            check(num(found[0], "y") > bottom(bar), "-25 under the hanging bar")
        else:
            check(num(found[0], "y") < num(bar, "y"), f"{content} over its bar")
    page.screenshot(path=str(e2e.OUTPUT / (PREFIX + "waterfall.png")))
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# 4. More types
# ----------------------------------------------------------------------

def test_gap_p6_more_types(browser):
    """More types: open `tests/output/charts-step4.html` (made by the tests). Slide 4: a 100% column chart (each year to
    100%, shares as 60% / 40%, 2025E lighter), stacked areas, a bubble chart of four named companies (growth in %
    across, EV/EBITDA up, bigger revenue = bigger bubble), and 100% bars for capital structure"""
    years = ["2022", "2023", "2024", "2025E"]
    mix = {"version": 1, "type": "stacked-column-100", "categories": years, "estimates": [False, False, False, True],
           "series": [{"name": "Varejo", "values": [120, 150, 170, 200]}, {"name": "Atacado", "values": [80, 70, 75, 70]}],
           "options": {"title": "Mix de receita", "dataLabels": True}}
    cumulative = {"version": 1, "type": "stacked-area", "categories": years,
                  "series": [{"name": "Brasil", "values": [100, 140, 190, 250]}, {"name": "Exterior", "values": [20, 35, 60, 90]}],
                  "options": {"title": "Receita acumulada"}}
    comps = {"version": 1, "type": "bubble", "categories": ["Alfa", "Beta", "Gama", "Delta"],
             "series": [{"name": "Crescimento", "values": [0.04, 0.09, 0.15, 0.12], "format": "percent"},
                        {"name": "EV/EBITDA", "values": [7.5, 9.8, 12.4, 8.9]},
                        {"name": "Receita", "values": [900, 400, 250, 600]}],
             "options": {"title": "Comparáveis"}}
    peers = {"version": 1, "type": "stacked-bar-100", "categories": ["Alfa", "Beta", "Gama"],
             "series": [{"name": "Dívida", "values": [30, 55, 20]}, {"name": "Equity", "values": [70, 45, 80]}],
             "options": {"title": "Estrutura de capital", "dataLabels": True}}
    deck = e2e.chart_deck(PREFIX + "charts-step4.html", [("e12", 40, 120, 600, 290, mix), ("e20", 40, 420, 600, 280, cumulative),
                                                          ("e21", 660, 260, 580, 230, comps), ("e22", 660, 500, 580, 200, peers)])
    editor = Editor(browser)
    editor.open(deck)
    editor.close_dialog_if_open()
    page = editor.page
    _go_to_slide(page, 3)

    # 100% columns: every year's stack the same height (100%), 60% / 40% in 2022, 2025E lighter.
    retail = nodes(page, "e12", "g.chart-series[data-series='0'] rect.chart-bar")
    wholesale = nodes(page, "e12", "g.chart-series[data-series='1'] rect.chart-bar")
    check(len(retail) == 4 and len(wholesale) == 4, "two series of four stacked columns")
    stacks = [num(a, "height") + num(b, "height") for a, b in zip(retail, wholesale)]
    check(max(stacks) - min(stacks) < 0.05, f"each year to 100% (same height): {stacks}")
    top_tick = nodes(page, "e12", ".chart-value-label")[-1]
    check(top_tick["text"] == "100%" and abs(num(wholesale[0], "y") - (num(top_tick, "y") - 14 * 0.35)) < 0.05,
          f"the stacks reach the 100% line: {top_tick['text']} {num(top_tick, 'y')} / {num(wholesale[0], 'y')}")
    check(all(abs(num(b, "y") + num(b, "height") - num(a, "y")) < 0.05 for a, b in zip(retail, wholesale)), "Atacado stacked on Varejo")
    labels = nodes(page, "e12", ".chart-data-label")
    check(label_on(labels, centre_x(retail[0]), "60%") and label_on(labels, centre_x(wholesale[0]), "40%")
          and abs(num(retail[0], "height") / stacks[0] - 0.6) < 0.005, f"2022 shares as 60% / 40%: {[l['text'] for l in labels]}")
    for i, (a, b) in enumerate(zip(retail, wholesale)):
        lighter = i == 3
        check((a["fillOpacity"] == b["fillOpacity"] == "0.5") == lighter and (a["fillOpacity"] == "1") != lighter,
              f"year {i}: lighter only in 2025E: {a['fillOpacity']} {b['fillOpacity']}")

    # Stacked areas: Exterior's area sits on Brasil's.
    areas = nodes(page, "e20", "path.chart-area")
    check(len(areas) == 2, f"two areas: {len(areas)}")
    lower, upper = (path_points(area["attrs"]["d"]) for area in areas)
    check(upper[4:][::-1] == lower[:4], f"the second area stacked on the first: {lower[:4]} / {upper[4:]}")
    check(all(y_up < y_low for (x, y_up), (x2, y_low) in zip(upper[:4], lower[:4])), "the upper area above the lower one")
    check(float(areas[0]["fillOpacity"]) > 0.5 and rgb(areas[0]["fill"]) != rgb(areas[1]["fill"]), "both filled, in two colours")

    # The bubble chart: four named companies; growth in % across, EV/EBITDA up, revenue as the bubble's size.
    bubbles = nodes(page, "e21", "circle.chart-point")
    check(len(bubbles) == 4, f"four bubbles: {len(bubbles)}")
    names = nodes(page, "e21", ".chart-data-label")
    check([n["text"] for n in names] == ["Alfa", "Beta", "Gama", "Delta"], "each bubble named")
    for bubble, name in zip(bubbles, names):
        check(abs(num(name, "y") - num(bubble, "cy") - 14 * 0.35) < 0.05
              and abs(abs(num(name, "x") - num(bubble, "cx")) - num(bubble, "r") - 4) < 0.05, f"{name['text']} beside its bubble")
    growth, multiple, revenue = [0.04, 0.09, 0.15, 0.12], [7.5, 9.8, 12.4, 8.9], [900, 400, 250, 600]
    order = lambda values: sorted(range(4), key=lambda i: values[i])  # noqa: E731
    check(order([num(b, "cx") for b in bubbles]) == order(growth), "more growth further right")
    check(order([-num(b, "cy") for b in bubbles]) == order(multiple), "higher EV/EBITDA further up")
    check(order([num(b, "r") for b in bubbles]) == order(revenue), "bigger revenue, bigger bubble")
    across = nodes(page, "e21", ".chart-value-label-x")
    check(len(across) >= 2 and all(n["text"].endswith("%") for n in across), f"growth in % across: {[n['text'] for n in across]}")
    titles = nodes(page, "e21", ".chart-axis-title")
    check([t["text"] for t in titles] == ["Crescimento", "EV/EBITDA"] and "rotate(-90" in titles[1]["attrs"].get("transform", "")
          and "transform" not in titles[0]["attrs"], "titles: Crescimento across, EV/EBITDA up the side")

    # 100% bars for capital structure.
    debt = nodes(page, "e22", "g.chart-series[data-series='0'] rect.chart-bar")
    equity = nodes(page, "e22", "g.chart-series[data-series='1'] rect.chart-bar")
    check(len(debt) == 3 and len(equity) == 3, "three companies of two bars")
    rows = [num(a, "width") + num(b, "width") for a, b in zip(debt, equity)]
    check(max(rows) - min(rows) < 0.05 and all(abs(num(a, "x") + num(a, "width") - num(b, "x")) < 0.05 for a, b in zip(debt, equity))
          and all(num(a, "y") == num(b, "y") for a, b in zip(debt, equity)), f"each company's bar to 100%, side by side: {rows}")
    check(abs(num(debt[1], "width") / rows[1] - 0.55) < 0.005, "Beta 55% debt")
    check(page.evaluate("App.deck.getDocument().querySelector('[data-id=\"e22\"] .chart-title').textContent") == "Estrutura de capital",
          "titled capital structure")
    check(page.evaluate("App.deck.getDocument().querySelectorAll('[data-chart-placeholder]').length") == 0, "no placeholder left")
    page.screenshot(path=str(e2e.OUTPUT / (PREFIX + "more-types.png")))
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# 5. Readability
# ----------------------------------------------------------------------

def test_gap_p6_readability(browser):
    """Readability: open `tests/output/charts-step5.html` (made by the tests). Slide 4: "CAGR 19,6%" in a pill on an
    arrow over the revenue columns and "Fonte: empresa" under the chart; in the bridge "Custos corporativos" on two
    lines; 24 months of columns with their names turned; long company names on two lines left of their bars"""
    combo = {"version": 1, "type": "combo", "categories": ["2022", "2023", "2024", "2025E"],
             "estimates": [False, False, False, True],
             "series": [{"name": "Receita (R$ mn)", "type": "column", "values": [410, 498, 587, 702]},
                        {"name": "Margem EBITDA", "type": "line", "axis": "secondary", "values": [0.18, 0.2, 0.21, 0.23],
                         "format": "percent"}],
             "options": {"title": "Receita e margem", "dataLabels": True, "cagr": {"series": 0, "from": 0, "to": 3},
                         "source": "Fonte: empresa"}}
    bridge = {"version": 1, "type": "waterfall",
              "categories": ["EBITDA 2024", "Novos parques", "Eficiência", "Custos corporativos", "EBITDA 2026E"],
              "series": [{"name": "R$ mn", "values": [240, 95, 30, -25, 340]}], "options": {"title": "Ponte"}}
    months = {"version": 1, "type": "column", "categories": [f"{i}/2024" for i in range(1, 25)],
              "series": [{"name": "Vendas", "values": [10 + i for i in range(24)]}], "options": {"title": "Vendas mensais"}}
    peers = {"version": 1, "type": "bar", "categories": ["Companhia Alfa de Energia", "Beta", "Gama Participações S.A."],
             "series": [{"name": "EV/EBITDA", "values": [9.8, 7.5, 11.2]}], "options": {"title": "Múltiplos"}}
    deck = e2e.chart_deck(PREFIX + "charts-step5.html", [("e12", 40, 120, 600, 340, combo), ("e20", 660, 260, 580, 220, bridge),
                                                          ("e21", 40, 470, 600, 230, months), ("e22", 660, 490, 580, 210, peers)])
    editor = Editor(browser)
    editor.open(deck)
    editor.close_dialog_if_open()
    page = editor.page
    _go_to_slide(page, 3)

    # "CAGR 19,6%" in a pill, on an arrow over the revenue columns.
    columns = nodes(page, "e12", "rect.chart-bar")
    label = nodes(page, "e12", ".chart-annotation .chart-cagr-label")
    pill = nodes(page, "e12", ".chart-annotation rect")
    arrow = nodes(page, "e12", "path.chart-cagr")
    head = nodes(page, "e12", "path.chart-cagr-head")
    check(len(label) == 1 and label[0]["text"] == "CAGR 19,6%", f"CAGR 19,6%: {[l['text'] for l in label]}")
    check(len(pill) == 1 and float(pill[0]["attrs"]["rx"]) * 2 == num(pill[0], "height")
          and num(pill[0], "x") < num(label[0], "x") < right(pill[0]) and num(pill[0], "y") < num(label[0], "y") < bottom(pill[0])
          and label[0]["box"]["x"] >= pill[0]["box"]["x"] and label[0]["box"]["x"] + label[0]["box"]["width"] <= pill[0]["box"]["x"] + pill[0]["box"]["width"],
          f"the label in a round-ended pill: {pill[0]['attrs'] if pill else None}")
    check(len(arrow) == 1 and len(head) == 1, "an arrow with its head")
    route = path_points(arrow[0]["attrs"]["d"])
    level = route[1][1]
    check(abs(route[0][0] - centre_x(columns[0])) < 0.05 and abs(route[3][0] - centre_x(columns[3])) < 0.05
          and route[1][1] == route[2][1], f"the arrow from the first column to the last: {route}")
    check(level < min(num(c, "y") for c in columns) and abs(num(pill[0], "y") + num(pill[0], "height") / 2 - level) < 0.05,
          f"the arrow (and its pill on it) over all the columns: {level}")
    tip = path_points(head[0]["attrs"]["d"])[0]
    check(abs(tip[0] - centre_x(columns[3])) < 0.05 and tip[1] < num(columns[3], "y"), "the head points down at the 2025E column")

    # "Fonte: empresa" under the chart.
    source = nodes(page, "e12", ".chart-source")
    lowest = max(num(n, "y") for n in nodes(page, "e12", ".chart-category-label") + nodes(page, "e12", ".chart-legend-label"))
    check(len(source) == 1 and source[0]["text"] == "Fonte: empresa" and num(source[0], "y") > lowest
          and num(source[0], "y") > max(bottom(c) for c in columns), f"Fonte: empresa under everything: {source}")

    # In the bridge, "Custos corporativos" on two lines.
    names = nodes(page, "e20", ".chart-category-label")
    costs = names[3]
    check(costs["tspans"] == ["Custos", "corporativos"] and costs["tspanYs"][1] > costs["tspanYs"][0] + 5,
          f"Custos corporativos on two lines: {costs['tspans']} {costs['tspanYs']}")

    # 24 months of columns, all their names turned.
    months_drawn = nodes(page, "e21", ".chart-category-label")
    check(len(nodes(page, "e21", "rect.chart-bar")) == 24, "24 columns")
    check([n["text"] for n in months_drawn] == [f"{i}/2024" for i in range(1, 25)], f"all 24 names shown: {len(months_drawn)}")
    check(all(re.match(r"rotate\(-45 ", n["attrs"].get("transform", "")) for n in months_drawn)
          and all(n["box"]["height"] > 20 for n in months_drawn), "every name turned 45 degrees")

    # Long company names on two lines, left of their bars.
    bars = nodes(page, "e22", "rect.chart-bar")
    companies = nodes(page, "e22", ".chart-category-label")
    check([" ".join(c["tspans"]) for c in companies] == ["Companhia Alfa de Energia", "", "Gama Participações S.A."]
          and all(len(companies[i]["tspans"]) == 2 and companies[i]["tspanYs"][1] > companies[i]["tspanYs"][0] + 5 for i in (0, 2))
          and companies[1]["text"] == "Beta", f"the long names on two lines, Beta on one: {[c['tspans'] or c['text'] for c in companies]}")
    for company, bar in zip(companies, bars):
        check(company["box"]["x"] + company["box"]["width"] <= bar["box"]["x"] + 0.5
              and company["box"]["y"] < bar["box"]["y"] + bar["box"]["height"] / 2 < company["box"]["y"] + company["box"]["height"],
              f"{company['text']} left of its bar, level with it")
    page.screenshot(path=str(e2e.OUTPUT / (PREFIX + "readability.png")))
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# 6. Insert a chart
# ----------------------------------------------------------------------

def _insert(page, kind):
    page.click(".ribbon-tab[data-tab='insert']")
    page.click(".ribbon-button.chart-button")
    page.click(f".chart-gallery-item[data-chart-type='{kind}']")
    return page.evaluate("App.selection.selectedId()")


def _type_in(page, selector, value):
    """Click a Format pane field, select what is in it, type `value` (empty: delete it) and press Enter."""
    page.click(selector)
    page.keyboard.press("Control+a")
    if value:
        page.keyboard.type(value)
    else:
        page.keyboard.press("Backspace")
    page.keyboard.press("Enter")


def test_gap_p6_insert_chart(browser):
    """Insert a chart: Insert > Chart ▾ lists 15 types; pick Combo: a chart with made-up numbers in the middle of the
    slide, selected; Ctrl+Z removes it. The Chart Design tab appears: Type ▾ Clustered Column (Ctrl+Z back), Data
    Labels, Gridlines off, Legend ▾ Right, CAGR ("CAGR 14,5%" over the columns). In the Format pane type a title,
    "Fonte: empresa" as Source, 200 as Axis maximum (then clear it: automatic again). Insert a Waterfall: Chart Design >
    Waterfall, the increase colour ▾ Blue. Save, reopen: all kept"""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    tab = ".ribbon-tab[data-tab='chart-design']"
    _go_to_slide(page, 4)
    charts_on_slide = "App.deck.getCurrentSlide().querySelectorAll('[data-type=\"chart\"]').length"
    check(page.evaluate(charts_on_slide) == 0 and page.is_hidden(tab), "no chart on the slide, no Chart Design tab")

    # Insert > Chart ▾ lists 15 types.
    page.click(".ribbon-tab[data-tab='insert']")
    page.click(".ribbon-button.chart-button")
    names = page.locator(".chart-gallery-item span").all_inner_texts()
    check(len(names) == 15 and page.is_visible(".chart-gallery"), f"15 chart types listed: {names}")
    check("Combo (columns + line)" in names and "Waterfall" in names, "Combo and Waterfall among them")

    # Pick Combo: made-up numbers, in the middle of the slide, selected.
    page.click(".chart-gallery-item[data-chart-type='combo']")
    chart = page.evaluate("App.selection.selectedId()")
    data = lambda: page.evaluate(CHART_DATA, chart)  # noqa: E731
    check(chart is not None and page.evaluate(charts_on_slide) == 1, "a chart on the slide")
    check(data()["series"][0]["values"] == [100, 120, 135, 150] and data()["series"][1]["values"] == [0.2, 0.22, 0.23, 0.25],
          f"made-up numbers: {data()['series']}")
    check(len(nodes(page, chart, "rect.chart-bar")) == 4 and len(nodes(page, chart, "path.chart-line")) == 1, "drawn as a combo")
    box = element_rect(page, chart)
    check(box["left"] + box["width"] / 2 == 640 and abs(box["top"] + box["height"] / 2 - 360) <= 15,
          f"in the middle of the 1280 x 720 slide: {box}")
    check(page.is_visible("#overlay .selection-box") and page.evaluate("App.selection.selectedIds()") == [chart], "selected")

    # Ctrl+Z removes it.
    page.keyboard.press("Control+z")
    check(page.evaluate(charts_on_slide) == 0, "Ctrl+Z: the chart is gone")
    check(page.is_hidden(tab), "and the Chart Design tab with it")

    # Insert it again; the Chart Design tab appears.
    chart = _insert(page, "combo")
    check(page.evaluate(charts_on_slide) == 1 and page.is_visible(tab), "Combo again: the Chart Design tab appears")
    page.click(tab)

    # Type ▾ Clustered Column; Ctrl+Z back.
    page.click(".list-button.chart-type")
    page.click(".chart-type-menu .menu-label:text-is('Clustered Column')")
    check(data()["type"] == "column" and len(nodes(page, chart, "path.chart-line")) == 0 and len(nodes(page, chart, "rect.chart-bar")) == 8,
          "Clustered Column: two series of columns, no line")
    page.keyboard.press("Control+z")
    check(data()["type"] == "combo" and len(nodes(page, chart, "path.chart-line")) == 1 and len(nodes(page, chart, "rect.chart-bar")) == 4,
          "Ctrl+Z: the combo back")

    # Data Labels.
    check(len(nodes(page, chart, ".chart-data-label")) == 0, "no numbers yet")
    page.click(".ribbon-button[data-command='chartDataLabels']")
    shown = texts(page, chart, ".chart-data-label")
    check(sorted(shown) == sorted(["100", "120", "135", "150", "20%", "22%", "23%", "25%"]), f"Data Labels: the numbers drawn: {shown}")

    # Gridlines off.
    check(len(nodes(page, chart, ".chart-gridline")) > 0, "gridlines before")
    page.click(".ribbon-button[data-command='chartGridlines']")
    check(len(nodes(page, chart, ".chart-gridline")) == 0, "Gridlines off: none drawn")

    # Legend ▾ Right.
    before = nodes(page, chart, ".chart-legend-label")
    check(len(before) == 2 and num(before[0], "y") == num(before[1], "y"), "the legend in a row (at the bottom) before")
    page.click(".list-button.chart-legend")
    page.click(".chart-legend-menu .menu-label:text-is('Right')")
    legend = nodes(page, chart, ".chart-legend-label")
    plot_right = max(n["box"]["x"] + n["box"]["width"] for n in nodes(page, chart, ".chart-value-label-secondary"))
    check([n["text"] for n in legend] == ["Receita", "Margem"] and num(legend[0], "x") == num(legend[1], "x")
          and num(legend[0], "y") < num(legend[1], "y") and min(n["box"]["x"] for n in legend) > plot_right,
          f"Legend Right: a column right of the chart: {[(n['attrs']['x'], n['attrs']['y']) for n in legend]}")

    # CAGR: "CAGR 14,5%" over the columns.
    page.click(".ribbon-button[data-command='chartCagr']")
    cagr = nodes(page, chart, ".chart-cagr-label")
    columns = nodes(page, chart, "rect.chart-bar")
    arrow = path_points(nodes(page, chart, "path.chart-cagr")[0]["attrs"]["d"])
    check(len(cagr) == 1 and cagr[0]["text"] == "CAGR 14,5%", f"CAGR 14,5%: {cagr}")
    check(arrow[1][1] < min(num(c, "y") for c in columns) and num(cagr[0], "y") < min(num(c, "y") for c in columns)
          and centre_x(columns[0]) < num(cagr[0], "x") < centre_x(columns[3]), "over the columns")
    check(page.get_attribute(".ribbon-button[data-command='chartCagr']", "aria-pressed") == "true", "CAGR shows it is on")

    # The Format pane: a title, the source, an axis maximum of 200, then cleared.
    _type_in(page, "#format-chart-title", "Receita e margem")
    wait_until(page, "id => (App.deck.getDocument().querySelector('[data-id=\"' + id + '\"] .chart-title') || {}).textContent === 'Receita e margem'", chart)
    check(texts(page, chart, ".chart-title") == ["Receita e margem"], "the title drawn")
    _type_in(page, "#format-chart-source", "Fonte: empresa")
    wait_until(page, "id => !!App.deck.getDocument().querySelector('[data-id=\"' + id + '\"] .chart-source')", chart)
    source = nodes(page, chart, ".chart-source")[0]
    check(source["text"] == "Fonte: empresa" and num(source, "y") > max(num(n, "y") for n in nodes(page, chart, ".chart-category-label")),
          "Fonte: empresa under the chart")
    automatic = texts(page, chart, ".chart-value-label")
    _type_in(page, "#format-chart-max", "200")
    wait_until(page, "id => JSON.parse(App.deck.getDocument().querySelector('[data-id=\"' + id + '\"] script.chart-data').textContent).options.axisMax === 200", chart)
    ticks = nodes(page, chart, ".chart-value-label")
    tallest = nodes(page, chart, "rect.chart-bar")[3]
    zero_y, top_y = num(ticks[0], "y"), num(ticks[-1], "y")
    check(ticks[-1]["text"] == "200" and automatic[-1] != "200", f"the axis up to 200: {[t['text'] for t in ticks]} (was {automatic})")
    check(abs(num(tallest, "height") / (zero_y - top_y) - 150 / 200) < 0.01, "150 drawn at three quarters of the axis")
    _type_in(page, "#format-chart-max", "")
    wait_until(page, "id => !('axisMax' in JSON.parse(App.deck.getDocument().querySelector('[data-id=\"' + id + '\"] script.chart-data').textContent).options)", chart)
    check(texts(page, chart, ".chart-value-label") == automatic and page.input_value("#format-chart-max") == "",
          f"cleared: the automatic axis again: {texts(page, chart, '.chart-value-label')}")
    page.screenshot(path=str(e2e.OUTPUT / (PREFIX + "chart-design.png")))

    # Insert a Waterfall: Chart Design > Waterfall, the increase colour ▾ Blue.
    page.keyboard.press("Escape")
    bridge = _insert(page, "waterfall")
    page.click(tab)
    increase = lambda: [rgb(b["fill"]) for b in nodes(page, bridge, "rect.chart-bar[data-role='increase']")]  # noqa: E731
    others = lambda: [rgb(b["fill"]) for b in nodes(page, bridge, "rect.chart-bar:not([data-role='increase'])")]  # noqa: E731
    check(increase() == [(60, 157, 93)], f"the increase green before: {increase()}")
    rest = others()
    page.click(".waterfall-increase-menu-button")
    page.click(".waterfall-increase-menu .color-swatch[title='Blue']")
    check(increase() == [(0, 112, 192)] and others() == rest, f"the increase blue, the rest unchanged: {increase()} {others()}")

    # Save, reopen: all kept.
    kept = {chart: page.evaluate(CHART_DATA, chart), bridge: page.evaluate(CHART_DATA, bridge)}
    saved = editor.save_as_download(PREFIX + "charts-design-saved.html")
    editor.open(saved)
    _go_to_slide(page, 4)
    check(page.evaluate(CHART_DATA, chart) == kept[chart] and page.evaluate(CHART_DATA, bridge) == kept[bridge], "the data kept")
    check(page.evaluate(CHART_DATA, chart)["type"] == "combo" and len(nodes(page, chart, "path.chart-line")) == 1, "still a combo")
    check(sorted(texts(page, chart, ".chart-data-label")) == sorted(shown), "data labels kept")
    check(len(nodes(page, chart, ".chart-gridline")) == 0, "gridlines still off")
    legend = nodes(page, chart, ".chart-legend-label")
    check(num(legend[0], "x") == num(legend[1], "x") and num(legend[0], "y") < num(legend[1], "y"), "legend still on the right")
    check(texts(page, chart, ".chart-cagr-label") == ["CAGR 14,5%"], "CAGR kept")
    check(texts(page, chart, ".chart-title") == ["Receita e margem"] and texts(page, chart, ".chart-source") == ["Fonte: empresa"],
          "title and source kept")
    check(texts(page, chart, ".chart-value-label") == automatic, "the axis still automatic")
    check(increase() == [(0, 112, 192)], f"the increase still blue: {increase()}")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# 7. Data grid
# ----------------------------------------------------------------------

def test_gap_p6_data_grid(browser):
    """Data grid: Insert > Chart > Clustered Column: the grid opens under the slide (the notes go). Type 200 over 100:
    the first column grows as you type. Enter goes down a row; type 1.234,5: read as one thousand two hundred… Close
    (×), Ctrl+Z: that cell back. Double-click the chart: the grid again. + Row, name it 2026, tick E; tick "E after
    estimate years" in the Format pane: the chart shows 2026E. + Series, name it EBITDA, type a number. Drag a row's ⠿
    to the top. × removes a row. A series' colour ▾ Green. In a Combo: Column / Line and the axis per series. In a
    Waterfall: each row's role (Start / Change / Subtotal / End)"""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    grid = "#chart-data-grid"
    cell = lambda row, col: f"{grid} input.cell[data-row='{row}'][data-col='{col}']"  # noqa: E731
    _go_to_slide(page, 4)
    check(page.is_hidden("#chart-data-panel") and page.is_visible("#notes-panel"), "the notes under the slide, no grid")

    # Insert > Chart > Clustered Column: the grid opens under the slide, the notes go.
    chart = _insert(page, "column")
    data = lambda: page.evaluate(CHART_DATA, chart)  # noqa: E731
    check(page.is_visible("#chart-data-panel") and page.is_hidden("#notes-panel"), "the grid open, the notes gone")
    panel, slide = page.locator("#chart-data-panel").bounding_box(), page.locator("#overlay").bounding_box()
    check(panel["y"] >= slide["y"] + slide["height"] - 1, f"the grid under the slide: {panel} / {slide}")
    check(page.input_value(cell(0, 0)) == "100", "the first cell reads 100")

    # Type 200 over 100: the first column grows with every key.
    heights = lambda: [num(r, "height") for r in nodes(page, chart, "rect.chart-bar")]  # noqa: E731
    page.click(cell(0, 0))
    check(page.evaluate("() => { const a = document.activeElement; return a.selectionStart === 0 && a.selectionEnd === a.value.length; }"),
          "clicking the cell selects its 100, so typing replaces it")
    grown = []
    for key, value in [("2", 2), ("0", 20), ("0", 200)]:
        page.keyboard.press(key)
        h = heights()
        check(data()["series"][0]["values"][0] == value and abs(h[0] / h[1] - value / 120) < 0.01,
              f"typed {value}: the first column drawn at {value} (vs 120): {h[:2]}")
        grown.append(h[0] / h[1])
    check(grown[0] < grown[1] < grown[2] and grown[2] > 1, f"the column grew as the keys were typed: {grown}")

    # Enter goes down a row; 1.234,5 read as one thousand two hundred thirty-four and a half.
    page.keyboard.press("Enter")
    check(page.evaluate("[document.activeElement.getAttribute('data-row'), document.activeElement.getAttribute('data-col')]") == ["1", "0"],
          "Enter: the cell below")
    page.keyboard.type("1.234,5")
    check(data()["series"][0]["values"][1] == 1234.5, f"1.234,5 read as 1234.5: {data()['series'][0]['values']}")
    h = heights()
    check(abs(h[1] / h[0] - 1234.5 / 200) < 0.01, f"drawn as 1234.5: {h[:2]}")

    # Close (×), Ctrl+Z: that cell back (only it).
    page.click("#chart-data-close")
    check(page.is_hidden("#chart-data-panel") and page.is_visible("#notes-panel"), "closed: the notes back")
    page.keyboard.press("Control+z")
    check(data()["series"][0]["values"][:2] == [200, 120], f"Ctrl+Z: that cell back to 120, the 200 stays: {data()['series'][0]['values']}")
    h = heights()
    check(abs(h[1] / h[0] - 120 / 200) < 0.01, "drawn back too")

    # Double-click the chart: the grid again.
    page.mouse.dblclick(*slide_to_screen(page, 640, 375))
    check(page.is_visible("#chart-data-panel") and page.input_value(cell(0, 0)) == "200", "double-click: the grid again")

    # + Row, name it 2026, tick E; "E after estimate years": the chart shows 2026E.
    page.click("#chart-data-add-row")
    check(page.evaluate("document.activeElement.matches('input.category[data-row=\"4\"]')"), "+ Row: the new row's name has the keyboard")
    page.keyboard.type("2026")
    page.keyboard.press("Enter")
    page.click(f"{grid} input.estimate[data-row='4']")
    check(data()["categories"][-1] == "2026" and data()["estimates"][-1] is True, f"2026 added, an estimate: {data()}")
    check(texts(page, chart, ".chart-category-label")[-1] == "2026", "the chart shows 2026")
    page.click("#format-chart-esuffix")
    check(page.is_checked("#format-chart-esuffix"), "E after estimate years ticked")
    check(texts(page, chart, ".chart-category-label") == ["2022", "2023", "2024", "2025E", "2026E"] and data()["categories"][-1] == "2026",
          f"the chart shows 2026E (the data keeps 2026): {texts(page, chart, '.chart-category-label')}")

    # + Series, name it EBITDA, type a number.
    page.click("#chart-data-add-series")
    check(page.evaluate("document.activeElement.matches('input.series-name[data-col=\"1\"]')"), "+ Series: its name has the keyboard")
    page.keyboard.type("EBITDA")
    page.keyboard.press("Enter")
    page.click(cell(4, 1))
    page.keyboard.type("40")
    check(data()["series"][1]["name"] == "EBITDA" and data()["series"][1]["values"][4] == 40, f"EBITDA 40 in 2026: {data()['series']}")
    ebitda = nodes(page, chart, "g.chart-series[data-series='1'] rect.chart-bar")
    check(len(ebitda) == 1 and ebitda[0]["fillOpacity"] == "0.5", "EBITDA's 2026 column drawn (lighter: an estimate)")
    check(texts(page, chart, ".chart-legend-label") == ["Receita", "EBITDA"], "the legend names EBITDA")

    # Drag the 2026 row's ⠿ to the top.
    handle = page.locator(f"{grid} .row-handle[data-row='4']").bounding_box()
    target = page.locator(f"{grid} tbody tr").first.bounding_box()
    drag(page, (handle["x"] + 4, handle["y"] + 4), (handle["x"] + 4, target["y"] + 3))
    check(data()["categories"] == ["2026", "2022", "2023", "2024", "2025E"] and data()["series"][1]["values"][0] == 40,
          f"2026 at the top with its numbers: {data()['categories']}")
    check(texts(page, chart, ".chart-category-label")[0] == "2026E", "the chart starts with 2026E")
    ebitda = nodes(page, chart, "g.chart-series[data-series='1'] rect.chart-bar")
    first_revenue = nodes(page, chart, "g.chart-series[data-series='0'] rect.chart-bar")[0]
    check(len(ebitda) == 1 and num(ebitda[0], "x") < num(first_revenue, "x"), "EBITDA's column moved to the first place with its row")

    # × removes a row (2022's).
    page.click(f"{grid} .row-remove[data-row='1']")
    check(data()["categories"] == ["2026", "2023", "2024", "2025E"] and page.locator(f"{grid} tbody tr").count() == 4, "× removed 2022")
    check(texts(page, chart, ".chart-category-label") == ["2026E", "2023", "2024", "2025E"], "the chart without 2022")

    # A series' colour ▾ Green.
    page.click(f"{grid} .series-color-menu-button >> nth=1")
    page.click(".series-color-menu .color-swatch[title='Green']")
    check(data()["series"][1].get("color") == "#00b050", f"EBITDA green: {data()['series'][1]}")
    check(rgb(nodes(page, chart, "g.chart-series[data-series='1'] rect.chart-bar")[0]["fill"]) == (0, 176, 80)
          and rgb(nodes(page, chart, ".chart-legend rect")[1]["fill"]) == (0, 176, 80), "its column and legend key drawn green")
    page.screenshot(path=str(e2e.OUTPUT / (PREFIX + "data-grid.png")))

    # In a Combo: Column / Line and the axis per series.
    page.keyboard.press("Escape")
    combo = _insert(page, "combo")
    count = lambda selector: len(nodes(page, combo, selector))  # noqa: E731
    check(count("path.chart-line") == 1 and count("rect.chart-bar") == 4, "the combo: columns and a line")
    page.select_option(f"{grid} select.series-type[data-col='1']", label="Column")
    check(count("path.chart-line") == 0 and count("rect.chart-bar") == 8, "the margin as columns")
    page.select_option(f"{grid} select.series-type[data-col='1']", label="Line")
    check(count("path.chart-line") == 1 and count("rect.chart-bar") == 4, "the margin a line again")
    check(count(".chart-value-label-secondary") >= 2, "the margin on the right axis")
    page.select_option(f"{grid} select.series-axis[data-col='1']", label="Main axis")
    check(page.evaluate(CHART_DATA, combo)["series"][1]["axis"] == "primary" and count(".chart-value-label-secondary") == 0,
          "the margin on the main axis: no right-hand axis")
    page.select_option(f"{grid} select.series-axis[data-col='1']", label="Right axis")
    check(page.evaluate(CHART_DATA, combo)["series"][1]["axis"] == "secondary" and count(".chart-value-label-secondary") >= 2,
          "the right-hand axis back")
    right_axis = lambda: texts(page, combo, ".chart-value-label-secondary")  # noqa: E731
    page.select_option(f"{grid} select.series-axis[data-col='0']", label="Right axis")
    check(page.evaluate(CHART_DATA, combo)["series"][0]["axis"] == "secondary" and right_axis()
          and not any(t.endswith("%") for t in right_axis()) and float(right_axis()[-1].replace(".", "").replace(",", ".")) >= 150,
          f"the revenue on the right axis too: its numbers there: {right_axis()}")
    page.select_option(f"{grid} select.series-axis[data-col='0']", label="Main axis")
    check(page.evaluate(CHART_DATA, combo)["series"][0]["axis"] == "primary" and all(t.endswith("%") for t in right_axis())
          and float(texts(page, combo, ".chart-value-label")[-1]) >= 150, f"the revenue back on the main axis: {right_axis()}")
    page.select_option(f"{grid} select.series-type[data-col='0']", label="Line")
    check(count("path.chart-line") == 2 and count("rect.chart-bar") == 0, "the revenue as a line too")

    # In a Waterfall: each row's role.
    page.keyboard.press("Escape")
    bridge = _insert(page, "waterfall")
    kinds = lambda: [r["attrs"]["data-role"] for r in nodes(page, bridge, "rect.chart-bar")]  # noqa: E731
    roles = lambda: page.evaluate(CHART_DATA, bridge)["roles"]  # noqa: E731
    check(kinds() == ["total", "increase", "decrease", "total"], f"start, two changes, end: {kinds()}")
    page.select_option(f"{grid} select.role[data-row='0']", label="Change")
    check(roles()[0] == "delta" and kinds()[0] == "increase", f"row 1 Change: drawn as an increase: {kinds()}")
    page.select_option(f"{grid} select.role[data-row='0']", label="Start")
    check(roles()[0] == "start" and kinds()[0] == "total", f"row 1 Start: a total again: {kinds()}")
    page.select_option(f"{grid} select.role[data-row='2']", label="Subtotal")
    check(roles()[2] == "subtotal" and kinds() == ["total", "increase", "total", "total"], f"row 3 Subtotal: drawn as a total: {kinds()}")
    page.select_option(f"{grid} select.role[data-row='3']", label="Change")
    check(roles()[3] == "delta" and kinds()[3] == "increase", f"row 4 Change: {kinds()}")
    page.select_option(f"{grid} select.role[data-row='3']", label="End")
    check(roles() == ["start", "delta", "subtotal", "end"] and kinds()[3] == "total", f"row 4 End: {roles()} {kinds()}")
    page.select_option(f"{grid} select.role[data-row='1']", label="Subtotal")
    check(roles()[1] == "subtotal" and kinds()[1] == "total", f"row 2 Subtotal: {kinds()}")
    page.select_option(f"{grid} select.role[data-row='1']", label="Change")
    check(roles() == ["start", "delta", "subtotal", "end"] and kinds() == ["total", "increase", "total", "total"], f"row 2 Change: {kinds()}")
    check(page.input_value(f"{grid} select.role[data-row='2']") == "subtotal", "the grid shows Subtotal")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# 8. Label numbers
# ----------------------------------------------------------------------

def test_gap_p6_label_numbers(browser):
    """Label numbers: insert a Clustered Column chart, Chart Design > Data Labels; Labels ▾ Inside End: the numbers move
    inside the columns (white; dark in the lighter 2025E). In the Format pane's Numbers: Decimals 1 and Units R$ mn:
    "100,0 R$ mn"; Written as 1,234.5: "100.0 R$ mn"; Negatives in parentheses on a chart with a negative number:
    (50). Ctrl+Z steps back one change at a time"""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    _go_to_slide(page, 4)
    chart = _insert(page, "column")
    page.click("#chart-data-close")

    def drawn(id_=None):
        """(text, fill, x, y) of each label and the columns' boxes."""
        target = id_ or chart
        return nodes(page, target, ".chart-data-label"), nodes(page, target, "rect.chart-bar")

    def outside_dark(labels, bars):
        return (len(labels) == 4 and all(num(l, "y") < num(b, "y") and rgb(l["fill"]) == (64, 64, 64) for l, b in zip(labels, bars)))

    # Chart Design > Data Labels: on top of the columns.
    page.click(".ribbon-tab[data-tab='chart-design']")
    page.click(".ribbon-button[data-command='chartDataLabels']")
    labels, bars = drawn()
    check([l["text"] for l in labels] == ["100", "120", "135", "150"] and outside_dark(labels, bars), "Data Labels: dark, over the columns")
    check(bars[3]["fillOpacity"] == "0.5" and all(b["fillOpacity"] == "1" for b in bars[:3]), "2025E the lighter column")

    # Labels ▾ Inside End: inside the columns, white; dark in the lighter 2025E.
    page.click(".list-button.chart-label-position")
    page.click(".chart-label-position-menu .menu-label:text-is('Inside End')")
    labels, bars = drawn()
    inside = all(num(b, "y") < num(l, "y") < num(b, "y") + num(b, "height") / 2 and abs(num(l, "x") - centre_x(b)) < 0.6
                 for l, b in zip(labels, bars))
    check(len(labels) == 4 and inside, "Inside End: each number inside the top of its column")
    check([rgb(l["fill"]) for l in labels] == [(255, 255, 255)] * 3 + [(64, 64, 64)], f"white; dark in 2025E: {[l['fill'] for l in labels]}")
    check(page.text_content(".list-button.chart-label-position").startswith("Labels: Inside End"), "the button says Inside End")

    # The Format pane's Numbers: Decimals 1, then Units R$ mn.
    first = lambda id_=None: drawn(id_)[0][0]["text"]  # noqa: E731
    _type_in(page, "#format-chart-decimals", "1")
    wait_until(page, "id => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"] .chart-data-label').textContent === '100,0'", chart)
    check(first() == "100,0", f"Decimals 1: {first()}")
    _type_in(page, "#format-chart-units", "R$ mn")
    wait_until(page, "id => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"] .chart-data-label').textContent !== '100,0'", chart)
    check(first() == "100,0 R$ mn", f"Units R$ mn: {first()}")

    # Written as 1,234.5: "100.0 R$ mn".
    page.select_option("#format-chart-locale", label="1,234.5")
    check(first() == "100.0 R$ mn", f"written as 1,234.5: {first()}")

    # Negatives in parentheses on a chart with a negative number: a second Clustered Column with -50 typed in.
    page.keyboard.press("Escape")
    negative = _insert(page, "column")
    page.click("#chart-data-grid input.cell[data-row='1'][data-col='0']")
    page.keyboard.type("-50")
    page.click("#chart-data-close")
    page.click(".ribbon-tab[data-tab='chart-design']")
    page.click(".ribbon-button[data-command='chartDataLabels']")
    labels, bars = drawn(negative)
    zero = nodes(page, negative, "line.chart-axis-line")[0]
    check(page.evaluate(CHART_DATA, negative)["series"][0]["values"] == [100, -50, 135, 150] and num(bars[1], "y") >= num(zero, "y1") - 0.01,
          "a chart with a negative number: its column hangs below zero")
    check([l["text"] for l in labels] == ["100", "-50", "135", "150"], f"-50 before: {[l['text'] for l in labels]}")
    page.click("#format-chart-parens")
    check(page.is_checked("#format-chart-parens"), "Negatives in parentheses ticked")
    labels, bars = drawn(negative)
    check([l["text"] for l in labels] == ["100", "(50)", "135", "150"], f"(50) drawn: {[l['text'] for l in labels]}")
    page.screenshot(path=str(e2e.OUTPUT / (PREFIX + "label-numbers.png")))

    # Ctrl+Z steps back one change at a time (focus on the ticked box, not in a text field).
    check(page.evaluate("document.activeElement.id") == "format-chart-parens", "the keyboard on the checkbox")
    steps = [
        ("parentheses", lambda: [l["text"] for l in drawn(negative)[0]] == ["100", "-50", "135", "150"]),
        ("data labels of the second chart", lambda: len(drawn(negative)[0]) == 0),
        ("the -50 typed", lambda: page.evaluate(CHART_DATA, negative)["series"][0]["values"] == [100, 120, 135, 150]),
        ("the second chart inserted", lambda: page.evaluate("id => !App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]')", negative)),
        ("written as 1,234.5", lambda: first() == "100,0 R$ mn"),
        ("units", lambda: first() == "100,0"),
        ("decimals", lambda: first() == "100"),
        ("Inside End", lambda: outside_dark(*drawn())),
        ("data labels", lambda: len(drawn()[0]) == 0),
    ]
    for name, state in steps:
        page.keyboard.press("Control+z")
        check(state(), f"Ctrl+Z undid {name} (one change): {[l['text'] for l in drawn()[0]]} / {page.evaluate('App.history.undoLabel()')}")
    check(page.evaluate(f"!!App.deck.getDocument().querySelector('[data-id=\"{chart}\"]')"), "the first chart itself still there")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


TESTS = [test_gap_p6_charts_drawn, test_gap_p6_lines_combo_donut, test_gap_p6_waterfall, test_gap_p6_more_types,
         test_gap_p6_readability, test_gap_p6_insert_chart, test_gap_p6_data_grid, test_gap_p6_label_numbers]
