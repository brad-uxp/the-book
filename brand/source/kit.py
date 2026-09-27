import importlib.util, os
spec = importlib.util.spec_from_file_location("b", "build.py"); b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
os.makedirs("brand", exist_ok=True)
DOT = b.V500
CUT = True

def adaptive(fg, dot, uid):
    # Android adaptive foreground: 108dp canvas, launcher shows the inner 72dp,
    # only the inner 66dp circle is guaranteed. The "b." spans 58% of what is shown.
    s = (0.58 * 1000 * 72 / 108) / 714
    w = 738 * s
    tx = (1000 - w) / 2 - 36 * s
    top = (1000 - 714 * s) / 2 - 7
    ty = top + 700 * s
    return (f'<svg viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg"><defs>{b.corner_clip(uid+"c")}</defs>'
            f'{b.mark_group(s, tx, ty, True, uid, fg, dot)}</svg>')

def square_icon(uid):
    svg = b.icon("squircle", cut=CUT, dot=DOT, uid=uid)
    return svg.replace('<rect width="1000" height="1000" rx="225" fill="#18181B"/>', '<rect width="1000" height="1000" fill="#18181B"/>')

files = {
  "wordmark.svg": b.wordmark(dot=DOT, cut=CUT, uid="bw"),
  "wordmark-reverse.svg": b.wordmark(text=b.PAPER, dot=DOT, cut=CUT, uid="bwr"),
  "wordmark-mono-ink.svg": b.wordmark(text=b.INK, dot=b.INK, cut=CUT, uid="bwi"),
  "wordmark-mono-paper.svg": b.wordmark(text=b.PAPER, dot=b.PAPER, cut=CUT, uid="bwp"),
  "icon.svg": b.icon("squircle", cut=CUT, dot=DOT, uid="bi"),
  "icon-square.svg": square_icon("bs"),
  "android-foreground.svg": adaptive(b.PAPER, DOT, "af"),
  "android-monochrome.svg": adaptive("#FFFFFF", "#FFFFFF", "am"),
  "notification.svg": b.icon("circle", cut=CUT, dot="#FFFFFF", bg="transparent", fg="#FFFFFF", uid="bn", ratio=0.78)
                        .replace('<circle cx="500" cy="500" r="500" fill="transparent"/>', ""),
}
for name, svg in files.items():
    open(f"brand/{name}", "w").write(svg + "\n")
    print(name, len(svg))
