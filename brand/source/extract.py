import json
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

f = TTFont("bricolage-var.ttf")
axes = {a.axisTag: (a.minValue, a.defaultValue, a.maxValue) for a in f["fvar"].axes}
print("axes", axes)
inst = instantiateVariableFont(f, {"wght": 800, "opsz": 96, "wdth": 100})
inst.save("bricolage-800-96.ttf")
gs = inst.getGlyphSet()
cmap = inst.getBestCmap()
upem = inst["head"].unitsPerEm
os2 = inst["OS/2"]
out = {"upem": upem, "xHeight": os2.sxHeight, "capHeight": os2.sCapHeight, "ascender": inst["hhea"].ascent, "descender": inst["hhea"].descent, "glyphs": {}}
for ch in "book.":
    name = cmap[ord(ch)]
    g = gs[name]
    pen = SVGPathPen(gs)
    g.draw(pen)
    bp = BoundsPen(gs); g.draw(bp)
    out["glyphs"][ch] = {"name": name, "advance": g.width, "d": pen.getCommands(), "bounds": bp.bounds}
json.dump(out, open("glyphs.json", "w"), indent=1)
for ch, gdat in out["glyphs"].items():
    print(repr(ch), gdat["name"], "adv", gdat["advance"], "bounds", gdat["bounds"], "len(d)", len(gdat["d"]))
print("upem", upem, "xHeight", out["xHeight"], "cap", out["capHeight"], "asc", out["ascender"])
