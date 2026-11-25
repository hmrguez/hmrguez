"""Convert one measured card to portable SVG with selectable text."""
import base64
import json
import sys
from collections import defaultdict
from pathlib import Path
from xml.etree import ElementTree as ET

import pymupdf

SVG = "http://www.w3.org/2000/svg"
XLINK = "http://www.w3.org/1999/xlink"
ET.register_namespace("", SVG)
ET.register_namespace("xlink", XLINK)
FONT_STACKS = {
    "Baskerville": "Baskerville,Georgia,serif",
    "Avenir Next": "Avenir Next,Arial,sans-serif",
    "Avenir Next Demi Bold": "Avenir Next Demi Bold,Avenir Next,Arial,sans-serif",
    "JetBrains Mono": "JetBrains Mono,monospace",
    "JetBrains Mono Medium": "JetBrains Mono Medium,JetBrains Mono,monospace",
}


def number(value):
    return f"{value:.3f}".rstrip("0").rstrip(".") or "0"


def compact_calendar(chart):
    """Encode consecutive same-color cells as horizontal dashed strokes."""
    rows = defaultdict(list)
    for cell in list(chart):
        if cell.tag.rsplit("}", 1)[-1] != "rect":
            continue
        width = float(cell.attrib["width"])
        rows[(cell.attrib["fill"], float(cell.attrib["y"]), width)].append(float(cell.attrib["x"]))
        chart.remove(cell)
    strokes = defaultdict(list)
    for (ink, y, width), positions in sorted(rows.items()):
        start = last = positions[0]
        for x in positions[1:]:
            if abs(x - last - width - 2) > 0.01:
                strokes[ink, width].append((start, y, last - start + width))
                start = x
            last = x
        strokes[ink, width].append((start, y, last - start + width))
    for (ink, width), runs in strokes.items():
        d = "".join(f"M{number(x)} {number(y+width/2)}h{number(length)}" for x, y, length in runs)
        ET.SubElement(chart, "path", {"fill": "none", "stroke": ink, "stroke-width": number(width),
                      "stroke-dasharray": f"{number(width)} 2", "d": d})


def convert(pdf_file, metadata, tile):
    width, height = metadata["width"], metadata["height"]
    root = ET.Element(f"{{{SVG}}}svg", {"width": str(width), "height": str(height),
                                       "viewBox": f"0 0 {width} {height}"})
    # Browser layout uses CSS pixels; the vector print layer uses PDF points.
    group = ET.SubElement(root, "g", {"transform": "scale(1.33333333)"})
    with pymupdf.open(pdf_file) as document:
        if len(document) != 1:
            raise ValueError("Expected one printed page per card")
        layer = ET.fromstring(document[0].get_svg_image(text_as_path=False))
    for text in layer.iter(f"{{{SVG}}}text"):
        family = text.get("font-family", "")
        text.set("font-family", FONT_STACKS.get(family, family))
    group.extend(layer)

    for insert in metadata["inserts"]:
        art = ET.fromstring(insert["source"])
        if art.get("class") == "map":
            compact_calendar(art)
        art.attrib.update({key: number(insert[key]) for key in ("x", "y", "width", "height")})
        root.append(art)

    if metadata["grain"]:
        bounds = metadata["paper"]
        inset = metadata["inset"]
        x, y = bounds["x"] + inset, bounds["y"] + inset
        shift = metadata["shift"]
        pattern = ET.SubElement(ET.SubElement(root, "defs"), "pattern", {
            "id": "grain", "patternUnits": "userSpaceOnUse", "width": "160", "height": "160",
            "x": number(x + shift), "y": number(y + shift)})
        ET.SubElement(pattern, "image", {"width": "160", "height": "160",
                      f"{{{XLINK}}}href": "data:image/webp;base64," + tile})
        ET.SubElement(root, "rect", {"x": number(x), "y": number(y),
                      "width": number(bounds["width"] - 2*inset), "height": number(bounds["height"] - 2*inset),
                      "fill": "url(#grain)", "style": "mix-blend-mode:multiply"})
    return ET.tostring(root, encoding="unicode")


if __name__ == "__main__":
    folder = Path(sys.argv[1])
    tile = base64.b64encode((Path(__file__).parent / "art/paper-tile.webp").read_bytes()).decode("ascii")
    for pdf in sorted(folder.glob("*.pdf")):
        meta = json.loads(pdf.with_suffix(".json").read_text())
        pdf.with_suffix(".svg").write_text(convert(pdf, meta, tile))
