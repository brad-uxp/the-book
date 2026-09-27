import json
G = json.load(open("glyphs.json"))["glyphs"]
INK, PAPER = "#18181B", "#FAFAFA"
V400, V500 = "#A78BFA", "#8B5CF6"
TRACK = -50
R = 90            # dot radius: a touch heavier than the 162-unit stem
OVER = 14         # round overshoot below the baseline, as the o has
CUT = 100         # the page-corner cut on the b's ascender

def corner_clip(cid):
    # Everything except a triangle off the top-left of the b's ascender.
    return (f'<clipPath id="{cid}"><path d="M-400 -400H3000V1200H-400Z '
            f'M36 700L{36+CUT} 700L36 {700-CUT}Z" clip-rule="evenodd"/></clipPath>')

def wordmark(text=INK, dot=V500, cut=False, uid="w"):
    xs, x = [], 0
    for ch in "book":
        xs.append(x); x += G[ch]["advance"] + TRACK
    k_right = xs[3] + G["k"]["bounds"][2]
    cx = k_right + 30 + R
    right = cx + R
    W, H = right - 36, 700 + OVER
    clip = f'<defs>{corner_clip(uid+"c")}</defs>' if cut else ""
    parts = []
    for i, ch in enumerate("book"):
        cp = f' clip-path="url(#{uid}c)"' if (cut and i == 0) else ""
        parts.append(f'<path transform="translate({xs[i]} 0)" d="{G[ch]["d"]}"{cp}/>')
    body = "".join(parts)
    return (f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="book.">{clip}'
            f'<g transform="translate(-36 700) scale(1 -1)" fill="{text}">{body}'
            f'<circle cx="{cx}" cy="{R-OVER}" r="{R}" fill="{dot}"/></g></svg>')

def mark_group(s, tx, ty, cut, uid, fg=PAPER, dot=V500):
    cp = f' clip-path="url(#{uid}c)"' if cut else ""
    cx = 554 + 40 + R
    return (f'<g transform="translate({tx:.1f} {ty:.1f}) scale({s:.4f} {-s:.4f})">'
            f'<path fill="{fg}" d="{G["b"]["d"]}"{cp}/>'
            f'<circle cx="{cx}" cy="{R-OVER}" r="{R}" fill="{dot}"/></g>')

def icon(shape="squircle", cut=False, dot=V500, bg=INK, fg=PAPER, uid="i", ratio=None):
    # Group "b." spans x 36..774, y -14..700 in font units.
    gw, gh = 738, 714
    ratio = ratio or (0.56 if shape == "squircle" else 0.58)
    s = 1000 * ratio / gh
    w = gw * s
    tx = (1000 - w) / 2 - 36 * s
    top = (1000 - gh * s) / 2 - 10
    ty = top + 700 * s
    clip = f'<defs>{corner_clip(uid+"c")}</defs>' if cut else ""
    base = (f'<rect width="1000" height="1000" rx="225" fill="{bg}"/>' if shape == "squircle"
            else f'<circle cx="500" cy="500" r="500" fill="{bg}"/>')
    return (f'<svg viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="book. app icon">{clip}'
            f'{base}{mark_group(s, tx, ty, cut, uid, fg, dot)}</svg>')

out = {
  "wm_orig": wordmark(uid="wo"), "wm_cut": wordmark(cut=True, uid="wc"),
  "wm_orig_dark": wordmark(text=PAPER, uid="wod"), "wm_cut_dark": wordmark(text=PAPER, cut=True, uid="wcd"),
  "wm_v400": wordmark(dot=V400, uid="w4"), "wm_v400_dark": wordmark(text=PAPER, dot=V400, uid="w4d"),
  "wm_v500": wordmark(dot=V500, uid="w5"), "wm_v500_dark": wordmark(text=PAPER, dot=V500, uid="w5d"),
  "wm_mono": wordmark(text=INK, dot=INK, uid="wm"), "wm_mono_dark": wordmark(text=PAPER, dot=PAPER, uid="wmd"),
  "ic_orig": icon(uid="io"), "ic_cut": icon(cut=True, uid="ic"),
  "ic_circle_orig": icon("circle", uid="ico"), "ic_circle_cut": icon("circle", cut=True, uid="icc"),
  "ic_v400": icon(dot=V400, uid="i4"), "ic_v500": icon(dot=V500, uid="i5"),
  "ic_light": icon(bg=PAPER, fg=INK, uid="il"),
}
json.dump(out, open("marks.json", "w"))
for k, v in out.items(): print(k, len(v))
