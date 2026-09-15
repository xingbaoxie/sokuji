# Side icons — source files

Delivered by an external designer on 2026-09-07 against the brief for
kizuna-ai-lab/sokuji#510. These SVGs are the source of truth for the
*geometry*; `../SideIcons.tsx` reproduces them as React components, and
`../SideIcons.test.tsx` fails if the two ever drift.

- `side-me.svg` — two speech bubbles, one right tail each: the user.
- `side-other.svg` — two speech bubbles, two left tails each: the other side, plural.
- `side-both.svg` — Other's upper bubble over Me's lower bubble.

In each file the upper path is the original line and the lower path is its
translation, carrying `line-source` / `line-translation` (`side-other` /
`side-me` in `side-both.svg`, whose two bubbles are sides rather than line
roles).

24-unit viewBox, paths only, `currentColor`, 2-unit round stroke, rendered at
14 px.

## Why three files and not eleven

The display mode — `both` / `translation` / `source` / `none` — changes
nothing but the `fill` on those two paths: shown is `currentColor`, hidden is
`none`, while `d` and `stroke` stay put. The delivery expanded that into eight
extra files, one per side per mode, of which `side-me--both.svg` and
`side-other--both.svg` were byte-identical to the two base files and the rest
differed from them in one attribute. Eleven files carried three geometries.

So the files hold the geometry and `SideIcons.tsx` holds the fill rule, which
is the half that is logic rather than drawing. To change a shape, edit the file
here and the matching constant in `SideIcons.tsx` together — the drift test
fails until they agree. To change which lines a mode shows, edit `SHOWN` in
`SideIcons.tsx`; no file here needs to move.

One local change from the delivery: `side-both.svg`'s paths were renamed from
`line-source` / `line-translation` to `side-other` / `side-me`, because Both
never toggles and the original names described Me/Other's lines, not Both's.
