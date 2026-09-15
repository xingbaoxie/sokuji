# Display Filter Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement kizuna-ai-lab/sokuji#510 — a fourth "hide this side" display mode, a safer cycle order, purpose-drawn side icons that carry the mode, and a legible toolbar rest colour.

**Architecture:** `DisplayMode` gains `'none'` and `shouldShowItem` honours it; the header/avatar consequence is already handled because MainPanel computes `prevItem` from the *filtered* list (`MainPanel.tsx:4179-4184`), so a fully hidden side never renders a header. The three side icons become React components in `src/components/Icons/SideIcons.tsx` (the `ProviderIcons.tsx` precedent), with the designer's SVG files committed beside them and a drift test that proves the components reproduce the files. `DisplayModeButton` and `ModePicker` swap lucide for those components. The toolbar rest colour becomes one SCSS token used by all four toolbar button rules.

**Tech Stack:** React 19 + TypeScript (strict), Zustand, i18next, SCSS via `sass`, Vitest + @testing-library/react (jsdom).

**Spec:** https://github.com/kizuna-ai-lab/sokuji/issues/510 (sections 1–3, "Decided", "Consequence to handle", "Before it ships", "Acceptance"). Designer delivery: `~/Downloads/sokuji-icons.zip` → extracted at `$CLAUDE_JOB_DIR/tmp/designer/sokuji-icons/` (11 SVG + README.md + 3 PNG).

## Global Constraints

- Cycle order is exactly `both → translation → source → none → both` (#510 §2).
- Both surfaces (`DisplayModeButton`, `ModePicker`) use the same three glyphs; the picker shows the `both` form and never toggles (#510 "Decided").
- Icons: 24-unit viewBox, paths only, `currentColor` only, 2-unit stroke, round caps and joins, rendered at 14 px; each line is one closed path; the icon box stays 14 × 14 in every mode (#510 §3, Acceptance).
- A hidden line is the same path with `fill="none"`; a shown line has `fill="currentColor"`; `d` and `stroke` never change (#510 §3 recipe).
- Toolbar rest colour is `#8a8a8a`, applied to `.display-mode-btn`, `.export-btn`, `.font-size-btn`, `.clear-conversation-btn` from **one** token; the picker's `#aaa` and the subtitle bar's `#c8c8c8` override are unchanged (#510 §3).
- `side-both.svg`'s paths are renamed from `line-source` / `line-translation` to `side-other` / `side-me` in both the committed file and the component (#510 "Before it ships").
- Existing stored three-mode configurations must still resolve (#510 Acceptance) — `'none'` is additive, nothing is renamed.
- English only in code, comments and repo docs (CLAUDE.md); conventional commit messages.
- Locale: edit `src/locales/en/translation.json` by hand, then run `node scripts/sync-locale-keys.mjs` to propagate to the other 29 locales (adds missing keys with the English value, drops keys `en` no longer has).
- Stylesheet invariants are asserted on **compiled** CSS (`compile` from `sass`), never by parsing SCSS source; selector regexes end in `(?![\w-])` (repo rule, see `SonioxVoiceSection.test.tsx:306`).
- Tests are colocated Vitest files; run one with `npx vitest run <path>`.
- Type gate: the repo has no `tsc` step in `build` (`vite build` only) and `npx tsc --noEmit -p tsconfig.json` reports ~311 pre-existing errors on the base commit. "Type-clean" therefore means **no errors beyond the saved baseline**: capture `tsc` output before the first change, and compare error lists with the `(line,col)` positions stripped, because any added line shifts later positions.
- Never `git stash` in this worktree (shared stash stack); commit instead.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/stores/settingsStore.ts:98` | Owns the `DisplayMode` union used by the main panel — widened with `'none'` |
| `src/stores/subtitleStore.ts:7` | The subtitle window's copy of the same union — widened identically |
| `src/components/MainPanel/conversationFilter.ts` | The one place that turns a mode into a row decision — learns `'none'` |
| `src/components/MainPanel/DisplayModeButton.tsx` | The cycling filter control — new order, `Off` label, `data-*` hooks, side icons |
| `src/components/MainPanel/ModePicker.tsx` | Footer segment control — side icons replace lucide |
| `src/components/Icons/SideIcons.tsx` | **New.** `SideMeIcon`, `SideOtherIcon` (mode-driven fills), `SideBothIcon` — the only owner of the path data |
| `src/components/Icons/side/*.svg`, `README.md` | **New.** Designer's files as the source of truth for the *geometry*; README records provenance, the `side-both` rename, and why three files rather than the eleven delivered |
| `src/styles/_tokens.scss` | Gains `$color-toolbar-icon` |
| `src/components/MainPanel/DisplayModeButton.scss`, `ExportButton.scss`, `MainPanel.scss` | The four toolbar rules read the token |
| `src/components/Subtitle/SubtitleBar.scss:103-105` | Comment only — stops naming `#555` |
| `src/locales/en/translation.json` `mainPanel.displayMode` | `none`, `title`, four `legend*` keys; `tooltip` removed |

Tests: `conversationFilter.test.ts` (extend), `subtitleStore.test.ts` (extend), `DisplayModeButton.test.tsx` (new), `ModePicker.test.tsx` (extend), `src/components/Icons/SideIcons.test.tsx` (new), `src/components/MainPanel/toolbarRestColour.test.ts` (new).

---

### Task 1: `'none'` display mode in the type and the filter

**Files:**
- Modify: `src/stores/settingsStore.ts:98`
- Modify: `src/stores/subtitleStore.ts:7`
- Modify: `src/components/MainPanel/conversationFilter.ts:8-25`
- Modify: `src/components/MainPanel/DisplayModeButton.tsx:15-19` (one entry, keeps the build green — order is finalised in Task 2)
- Test: `src/components/MainPanel/conversationFilter.test.ts`
- Test: `src/stores/subtitleStore.test.ts`

**Interfaces:**
- Produces: `type DisplayMode = 'source' | 'translation' | 'both' | 'none'` (both stores, identical); `shouldShowItem(item, speakerMode, participantMode)` returns `false` for every message row of a side whose mode is `'none'`.

- [ ] **Step 1: Write the failing filter tests**

Append inside the `describe('shouldShowItem', …)` block of `src/components/MainPanel/conversationFilter.test.ts`:

```ts
  it('hides both participant roles when participantMode=none', () => {
    expect(shouldShowItem(baseItem({ source: 'participant', role: 'user' }), 'both', 'none')).toBe(false);
    expect(shouldShowItem(baseItem({ source: 'participant', role: 'assistant' }), 'both', 'none')).toBe(false);
  });

  it('hides both speaker roles when speakerMode=none', () => {
    expect(shouldShowItem(baseItem({ source: 'speaker', role: 'user' }), 'none', 'both')).toBe(false);
    expect(shouldShowItem(baseItem({ source: 'speaker', role: 'assistant' }), 'none', 'both')).toBe(false);
  });

  it('none on one side leaves the other side untouched', () => {
    expect(shouldShowItem(baseItem({ source: 'speaker', role: 'user' }), 'both', 'none')).toBe(true);
    expect(shouldShowItem(baseItem({ source: 'participant', role: 'assistant' }), 'none', 'both')).toBe(true);
  });

  it('error and system rows still pass when their side is none', () => {
    expect(shouldShowItem(baseItem({ source: 'participant', type: 'error' }), 'both', 'none')).toBe(true);
    expect(shouldShowItem(baseItem({ source: 'participant', role: 'system' }), 'both', 'none')).toBe(true);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/MainPanel/conversationFilter.test.ts`
Expected: the four new tests FAIL — TypeScript rejects `'none'` as an argument (type error surfaces as a failed transform) or, if type checking is skipped at test time, the first two assertions fail because `'none'` currently falls through to `return true`.

- [ ] **Step 3: Widen the union in both stores**

`src/stores/settingsStore.ts` line 98 — replace:

```ts
export type DisplayMode = 'source' | 'translation' | 'both';
```

with:

```ts
// 'none' hides every row of that side. The subtitle store carries an identical
// copy of this union (subtitleStore.ts) — change both together.
export type DisplayMode = 'source' | 'translation' | 'both' | 'none';
```

`src/stores/subtitleStore.ts` line 7 — replace:

```ts
export type DisplayMode = 'source' | 'translation' | 'both';
```

with:

```ts
// Mirror of settingsStore's DisplayMode — change both together.
export type DisplayMode = 'source' | 'translation' | 'both' | 'none';
```

- [ ] **Step 4: Teach the filter `'none'`**

`src/components/MainPanel/conversationFilter.ts` — replace the body from `const source = …` to the end of the function with:

```ts
  const source = item.source ?? 'speaker';
  const mode = source === 'speaker' ? speakerMode : participantMode;

  if (mode === 'both') return true;
  // 'none' hides the whole side. Error and system rows were let through above
  // on purpose: a failure on a hidden side must still be visible somewhere.
  if (mode === 'none') return false;
  if (mode === 'source') return item.role === 'user';
  if (mode === 'translation') return item.role === 'assistant';
  return true;
```

- [ ] **Step 5: Keep `DisplayModeButton` compiling**

`src/components/MainPanel/DisplayModeButton.tsx` lines 15–19 — replace the `CYCLE` constant with:

```ts
const CYCLE: Record<DisplayMode, DisplayMode> = {
  both: 'source',
  source: 'translation',
  translation: 'both',
  none: 'both',
};
```

(`Record<DisplayMode, …>` is exhaustive; without this entry the project no longer type-checks. Task 2 rewrites the order.)

- [ ] **Step 6: Write the failing store round-trip test**

In `src/stores/subtitleStore.test.ts`, directly after the existing test `'setSpeakerDisplayMode / setParticipantDisplayMode store the new mode'` (line 72), add:

```ts
  it('accepts the none display mode on either side', async () => {
    await useSubtitleStore.getState().setParticipantDisplayMode('none');
    expect(useSubtitleStore.getState().participantDisplayMode).toBe('none');
    await useSubtitleStore.getState().setSpeakerDisplayMode('none');
    expect(useSubtitleStore.getState().speakerDisplayMode).toBe('none');
  });
```

- [ ] **Step 7: Run both test files and the type check**

Run: `npx vitest run src/components/MainPanel/conversationFilter.test.ts src/stores/subtitleStore.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: all tests PASS (conversationFilter: 14 previously passing + 4 new; subtitleStore: +1); `tsc` reports no errors beyond the baseline (see Global Constraints) — in particular the two `'"none"' is not assignable` errors from the RED step are gone.

- [ ] **Step 8: Commit**

```bash
git add src/stores/settingsStore.ts src/stores/subtitleStore.ts src/components/MainPanel/conversationFilter.ts src/components/MainPanel/conversationFilter.test.ts src/components/MainPanel/DisplayModeButton.tsx src/stores/subtitleStore.test.ts
git commit -m "feat(display-filter): add a none display mode that hides a whole side"
```

---

### Task 2: Cycle order, `Off` label, and the locale keys

**Files:**
- Modify: `src/components/MainPanel/DisplayModeButton.tsx`
- Modify: `src/locales/en/translation.json` (`mainPanel.displayMode` object)
- Modify: `src/locales/*/translation.json` (29 files, by script)
- Test: `src/components/MainPanel/DisplayModeButton.test.tsx` (new)

**Interfaces:**
- Consumes: `DisplayMode` from Task 1.
- Produces: `DisplayModeButton` renders `<button class="display-mode-btn" data-scope={scope} data-mode={value}>`; one click cycles `both → translation → source → none → both`; label for `'none'` is `t('mainPanel.displayMode.none', 'Off')`. Locale keys `mainPanel.displayMode.none`, `.title`, `.legendSource`, `.legendTranslation`, `.legendBoth`, `.legendNone` exist; `.tooltip` no longer exists.

- [ ] **Step 1: Write the failing button tests**

Create `src/components/MainPanel/DisplayModeButton.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DisplayModeButton from './DisplayModeButton';
import type { DisplayMode } from '../../stores/settingsStore';

const click = (value: DisplayMode) => {
  const onChange = vi.fn();
  render(<DisplayModeButton scope="participant" value={value} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button'));
  return onChange;
};

describe('DisplayModeButton', () => {
  it('cycles both → translation → source → none → both', () => {
    expect(click('both')).toHaveBeenCalledWith('translation');
    expect(click('translation')).toHaveBeenCalledWith('source');
    expect(click('source')).toHaveBeenCalledWith('none');
    expect(click('none')).toHaveBeenCalledWith('both');
  });

  it('exposes scope and mode as data attributes', () => {
    render(<DisplayModeButton scope="speaker" value="none" onChange={() => {}} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('data-scope', 'speaker');
    expect(btn).toHaveAttribute('data-mode', 'none');
  });

  it('labels the hidden mode', () => {
    render(<DisplayModeButton scope="participant" value="none" onChange={() => {}} />);
    // i18n may resolve to a translation in some environments; the English
    // default is what ships in en/translation.json.
    expect(screen.getByRole('button').textContent).toMatch(/Off|关闭|隐藏/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/MainPanel/DisplayModeButton.test.tsx`
Expected: FAIL — `click('both')` receives `'source'` (old order); `data-scope` / `data-mode` missing; `none` label falls to `'Trans'`.

- [ ] **Step 3: Rewrite `DisplayModeButton.tsx`**

Replace the whole file with:

```tsx
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Users } from 'lucide-react';
import type { DisplayMode } from '../../stores/settingsStore';
import './DisplayModeButton.scss';

export type DisplayScope = 'speaker' | 'participant';

interface DisplayModeButtonProps {
  scope: DisplayScope;
  value: DisplayMode;
  onChange: (next: DisplayMode) => void;
}

// One accidental click from the default lands on translation-only — still the
// thing the user came for — never on source-only, which reads as "translation
// stopped working". none is three clicks away and one click from recovery.
const CYCLE: Record<DisplayMode, DisplayMode> = {
  both: 'translation',
  translation: 'source',
  source: 'none',
  none: 'both',
};

const DisplayModeButton: React.FC<DisplayModeButtonProps> = ({ scope, value, onChange }) => {
  const { t } = useTranslation();

  const scopeLabel = t(
    scope === 'speaker' ? 'mainPanel.displayMode.speaker' : 'mainPanel.displayMode.participant',
    scope === 'speaker' ? 'Me' : 'Other'
  );
  const modeLabel = useMemo(() => {
    if (value === 'both') return t('mainPanel.displayMode.both', 'Both');
    if (value === 'source') return t('mainPanel.displayMode.source', 'Src');
    if (value === 'none') return t('mainPanel.displayMode.none', 'Off');
    return t('mainPanel.displayMode.translation', 'Trans');
  }, [value, t]);

  // The legend is assembled from per-mode keys rather than one enumerated
  // string, so a locale that has translated three modes does not keep showing
  // a three-line legend after the fourth mode lands.
  const title = [
    t('mainPanel.displayMode.title', '{{scope}} — click to change\nNow showing: {{mode}}', { scope: scopeLabel, mode: modeLabel }),
    '• ' + t('mainPanel.displayMode.legendSource', 'Src: only the original speech'),
    '• ' + t('mainPanel.displayMode.legendTranslation', 'Trans: only the translation'),
    '• ' + t('mainPanel.displayMode.legendBoth', 'Both: both lines'),
    '• ' + t('mainPanel.displayMode.legendNone', 'Off: hide this side'),
  ].join('\n');
  const ariaLabel = t(
    'mainPanel.displayMode.ariaLabel',
    '{{scope}}: {{mode}} — click to change',
    { scope: scopeLabel, mode: modeLabel },
  );

  const handleClick = useCallback(() => {
    onChange(CYCLE[value]);
  }, [onChange, value]);

  const Icon = scope === 'speaker' ? User : Users;

  return (
    <button
      type="button"
      className="display-mode-btn"
      data-scope={scope}
      data-mode={value}
      onClick={handleClick}
      title={title}
      aria-label={ariaLabel}
    >
      <Icon size={14} />
      <span className="display-mode-label">{modeLabel}</span>
    </button>
  );
};

export default DisplayModeButton;
```

- [ ] **Step 4: Update the English locale**

Run `grep -n '"displayMode"' src/locales/en/translation.json` to find the block (it is under `"mainPanel"`). Edit that object so it reads exactly:

```json
"displayMode": {
  "speaker": "Me",
  "participant": "Other",
  "both": "Both",
  "source": "Src",
  "translation": "Trans",
  "none": "Off",
  "title": "{{scope}} — click to change\nNow showing: {{mode}}",
  "legendSource": "Src: only the original speech",
  "legendTranslation": "Trans: only the translation",
  "legendBoth": "Both: both lines",
  "legendNone": "Off: hide this side",
  "ariaLabel": "{{scope}}: {{mode}} — click to change"
}
```

Keep the file's surrounding indentation as it is (`en` is hand-formatted; only this object changes). The `tooltip` key is gone.

- [ ] **Step 5: Propagate to the other locales**

Run: `node scripts/sync-locale-keys.mjs`
Expected: it reports keys filled for 29 locales (`mainPanel.displayMode.none`, `.title`, `.legendSource`, `.legendTranslation`, `.legendBoth`, `.legendNone`) and `mainPanel.displayMode.tooltip` dropped. Verify: `grep -L '"legendNone"' src/locales/*/translation.json` prints nothing, and `grep -l '"tooltip"' src/locales/*/translation.json | xargs -r grep -c 'displayMode' | grep -v ':0' ` prints nothing.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/components/MainPanel/DisplayModeButton.test.tsx src/components/MainPanel/conversationFilter.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/MainPanel/DisplayModeButton.tsx src/components/MainPanel/DisplayModeButton.test.tsx src/locales
git commit -m "feat(display-filter): reorder the cycle and label the hidden mode"
```

---

### Task 3: The side icon components and their drift test

**Files:**
- Create: `src/components/Icons/side/side-me.svg`, `side-other.svg`, `side-both.svg`, `side-me--both.svg`, `side-me--translation.svg`, `side-me--source.svg`, `side-me--none.svg`, `side-other--both.svg`, `side-other--translation.svg`, `side-other--source.svg`, `side-other--none.svg` (copied from the designer delivery), `src/components/Icons/side/README.md`
- Create: `src/components/Icons/SideIcons.tsx`
- Test: `src/components/Icons/SideIcons.test.tsx` (new)

**Interfaces:**
- Consumes: `DisplayMode` from Task 1.
- Produces:
  - `SideMeIcon: React.FC<{ mode?: DisplayMode; size?: number | string; className?: string; style?: React.CSSProperties }>` — default `mode='both'`, `size=24`.
  - `SideOtherIcon` — same signature.
  - `SideBothIcon: React.FC<{ size?: number | string; className?: string; style?: React.CSSProperties }>`.
  - Each renders `<svg data-icon="side-me" | "side-other" | "side-both" aria-hidden="true" viewBox="0 0 24 24">` containing exactly two `<path>` elements. Me/Other paths carry `class="line-source"` and `class="line-translation"`; Both carries `class="side-other"` and `class="side-me"`. A shown path has `fill="currentColor"`, a hidden one `fill="none"`; every path has `stroke="currentColor" stroke-width="2"`.

- [ ] **Step 1: Copy the assets and write the README**

```bash
mkdir -p src/components/Icons/side
cp "$CLAUDE_JOB_DIR/tmp/designer/sokuji-icons/"side-*.svg src/components/Icons/side/
```

Then edit `src/components/Icons/side/side-both.svg` so its two `class` attributes read `class="side-other"` (first path) and `class="side-me"` (second path) — nothing else in the file changes.

Create `src/components/Icons/side/README.md`:

```markdown
# Side icons — source files

Delivered by an external designer on 2026-09-07 against the brief for
kizuna-ai-lab/sokuji#510. These SVGs are the source of truth;
`../SideIcons.tsx` reproduces them as React components, and
`../SideIcons.test.tsx` fails if the two ever drift.

- `side-me.svg` — two speech bubbles, one right tail each: the user.
- `side-other.svg` — two speech bubbles, two left tails each: the other side, plural.
- `side-both.svg` — Other's upper bubble over Me's lower bubble.
- `side-{me,other}--{both,translation,source,none}.svg` — the four display
  modes expanded: upper path = original line, lower path = translation line,
  `fill="currentColor"` when shown, `fill="none"` when hidden; `d` and
  `stroke` never change.

24-unit viewBox, paths only, `currentColor`, 2-unit round stroke, rendered at
14 px. `side-me.svg` and `side-other.svg` are byte-identical to their
`--both` files.

One local change from the delivery: `side-both.svg`'s paths were renamed from
`line-source` / `line-translation` to `side-other` / `side-me`, because Both
never toggles and the original names described Me/Other's lines, not Both's.
```

- [ ] **Step 2: Write the failing component tests**

Create `src/components/Icons/SideIcons.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SideMeIcon, SideOtherIcon, SideBothIcon } from './SideIcons';
import type { DisplayMode } from '../../stores/settingsStore';

const svgFile = (name: string) =>
  new DOMParser().parseFromString(
    readFileSync(resolve(__dirname, 'side', `${name}.svg`), 'utf8'),
    'image/svg+xml',
  );

const pathsOf = (root: ParentNode) =>
  Array.from(root.querySelectorAll('path')).map((p) => ({
    cls: p.getAttribute('class'),
    d: p.getAttribute('d'),
    fill: p.getAttribute('fill'),
    stroke: p.getAttribute('stroke'),
    strokeWidth: p.getAttribute('stroke-width'),
  }));

const MODES: DisplayMode[] = ['both', 'translation', 'source', 'none'];

describe('SideIcons', () => {
  it('render one svg with exactly two paths and a data-icon name', () => {
    for (const [Icon, name] of [[SideMeIcon, 'side-me'], [SideOtherIcon, 'side-other'], [SideBothIcon, 'side-both']] as const) {
      const { container } = render(<Icon />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('data-icon')).toBe(name);
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.querySelectorAll('path')).toHaveLength(2);
    }
  });

  it('size sets width and height, default 24', () => {
    const { container } = render(<SideMeIcon size={14} />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '14');
    expect(container.querySelector('svg')).toHaveAttribute('height', '14');
    const def = render(<SideOtherIcon />).container.querySelector('svg')!;
    expect(def.getAttribute('width')).toBe('24');
  });

  it('Me and Other reproduce the designer files in every mode', () => {
    for (const [Icon, name] of [[SideMeIcon, 'side-me'], [SideOtherIcon, 'side-other']] as const) {
      for (const mode of MODES) {
        const { container } = render(<Icon mode={mode} />);
        expect(pathsOf(container), `${name}--${mode}`).toEqual(pathsOf(svgFile(`${name}--${mode}`)));
      }
      // The base file is the both form.
      const { container } = render(<Icon />);
      expect(pathsOf(container), `${name} default`).toEqual(pathsOf(svgFile(name)));
    }
  });

  it('Both reproduces side-both.svg and is always fully shown', () => {
    const { container } = render(<SideBothIcon />);
    expect(pathsOf(container)).toEqual(pathsOf(svgFile('side-both')));
    for (const p of pathsOf(container)) expect(p.fill).toBe('currentColor');
    expect(pathsOf(container).map((p) => p.cls)).toEqual(['side-other', 'side-me']);
  });

  it('hidden lines keep their geometry and stroke', () => {
    const shown = pathsOf(render(<SideMeIcon mode="both" />).container);
    const hidden = pathsOf(render(<SideMeIcon mode="none" />).container);
    expect(hidden.map((p) => p.d)).toEqual(shown.map((p) => p.d));
    expect(hidden.map((p) => p.stroke)).toEqual(['currentColor', 'currentColor']);
    expect(hidden.map((p) => p.fill)).toEqual(['none', 'none']);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/components/Icons/SideIcons.test.tsx`
Expected: FAIL — `./SideIcons` cannot be resolved.

- [ ] **Step 4: Create `SideIcons.tsx`**

```tsx
import React from 'react';
import type { DisplayMode } from '../../stores/settingsStore';

// The conversation's two sides as speech bubbles. Upper bubble = the original
// line, lower bubble = its translation; a shown line is solid, a hidden line is
// the same outline. Tails carry who: one right tail per bubble is Me, two left
// tails per bubble is Other, and Both is Other's upper bubble over Me's lower.
// Path data is verbatim from ./side/*.svg — SideIcons.test.tsx fails if the
// two drift, so edit the file and the constant together.

interface SideIconProps {
  size?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

interface SideModeIconProps extends SideIconProps {
  mode?: DisplayMode;
}

const ME_SOURCE =
  'M 4 2 H 20 Q 22 2 22 4 V 5 Q 22 7 20 7 V 10 L 16 7 H 4 Q 2 7 2 5 V 4 Q 2 2 4 2 Z';
const ME_TRANSLATION =
  'M 4 14 H 20 Q 22 14 22 16 V 17 Q 22 19 20 19 V 22 L 16 19 H 4 Q 2 19 2 17 V 16 Q 2 14 4 14 Z';
const OTHER_SOURCE =
  'M 4 2 H 20 Q 22 2 22 4 V 5 Q 22 7 20 7 H 14 L 10 10 V 7 H 7 L 3 10 V 6.7 Q 2 6.3 2 5 V 4 Q 2 2 4 2 Z';
const OTHER_TRANSLATION =
  'M 4 14 H 20 Q 22 14 22 16 V 17 Q 22 19 20 19 H 14 L 10 22 V 19 H 7 L 3 22 V 18.7 Q 2 18.3 2 17 V 16 Q 2 14 4 14 Z';

// [upper line shown, lower line shown]
const SHOWN: Record<DisplayMode, [boolean, boolean]> = {
  both: [true, true],
  translation: [false, true],
  source: [true, false],
  none: [false, false],
};

const Line: React.FC<{ cls: string; d: string; shown: boolean }> = ({ cls, d, shown }) => (
  <path className={cls} d={d} fill={shown ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} />
);

const Frame: React.FC<SideIconProps & { name: string; children: React.ReactNode }> = ({
  name, size = 24, className, style, children,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
    data-icon={name}
    aria-hidden="true"
    className={className}
    style={style}
  >
    {children}
  </svg>
);

export const SideMeIcon: React.FC<SideModeIconProps> = ({ mode = 'both', ...rest }) => {
  const [upper, lower] = SHOWN[mode];
  return (
    <Frame name="side-me" {...rest}>
      <Line cls="line-source" d={ME_SOURCE} shown={upper} />
      <Line cls="line-translation" d={ME_TRANSLATION} shown={lower} />
    </Frame>
  );
};

export const SideOtherIcon: React.FC<SideModeIconProps> = ({ mode = 'both', ...rest }) => {
  const [upper, lower] = SHOWN[mode];
  return (
    <Frame name="side-other" {...rest}>
      <Line cls="line-source" d={OTHER_SOURCE} shown={upper} />
      <Line cls="line-translation" d={OTHER_TRANSLATION} shown={lower} />
    </Frame>
  );
};

// No mode: Both never toggles, and its paths are named for the side they
// belong to rather than for a line role.
export const SideBothIcon: React.FC<SideIconProps> = (props) => (
  <Frame name="side-both" {...props}>
    <Line cls="side-other" d={OTHER_SOURCE} shown />
    <Line cls="side-me" d={ME_TRANSLATION} shown />
  </Frame>
);
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/components/Icons/SideIcons.test.tsx`
Expected: PASS (5 tests). If the drift test fails on `strokeWidth`, the SVG files carry `stroke-width="2"` as a string and React renders `strokeWidth={2}` as `stroke-width="2"` — compare as strings, which `getAttribute` already does; the remaining cause would be a transcription slip in a `d` constant — fix the constant, never the file.

- [ ] **Step 6: Commit**

```bash
git add src/components/Icons/side src/components/Icons/SideIcons.tsx src/components/Icons/SideIcons.test.tsx
git commit -m "feat(icons): add the side bubble icon set with mode-driven fills"
```

---

### Task 4: Wire the icons into `DisplayModeButton` and `ModePicker`

**Files:**
- Modify: `src/components/MainPanel/DisplayModeButton.tsx` (icon import and element)
- Modify: `src/components/MainPanel/ModePicker.tsx:3,17-24,99`
- Test: `src/components/MainPanel/DisplayModeButton.test.tsx` (extend)
- Test: `src/components/MainPanel/ModePicker.test.tsx` (extend)

**Interfaces:**
- Consumes: `SideMeIcon`, `SideOtherIcon`, `SideBothIcon` from Task 3; `DisplayModeButton` from Task 2.
- Produces: `DisplayModeButton` renders `SideMeIcon`/`SideOtherIcon` with `mode={value}` and `size={14}`; `ModePicker` renders `SideMeIcon` (speaker), `SideOtherIcon` (participant), `SideBothIcon` (both), each `size={14}`, Me/Other in their default `both` form. No lucide import remains in either file.

- [ ] **Step 1: Write the failing tests**

Append to the `describe` in `src/components/MainPanel/DisplayModeButton.test.tsx`:

```tsx
  it('renders the side icon for its scope with the current mode applied', () => {
    const { container, rerender } = render(<DisplayModeButton scope="participant" value="translation" onChange={() => {}} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('data-icon')).toBe('side-other');
    expect(svg.getAttribute('width')).toBe('14');
    expect(svg.querySelector('.line-source')).toHaveAttribute('fill', 'none');
    expect(svg.querySelector('.line-translation')).toHaveAttribute('fill', 'currentColor');

    rerender(<DisplayModeButton scope="speaker" value="none" onChange={() => {}} />);
    const me = container.querySelector('svg')!;
    expect(me.getAttribute('data-icon')).toBe('side-me');
    expect(me.querySelector('.line-source')).toHaveAttribute('fill', 'none');
    expect(me.querySelector('.line-translation')).toHaveAttribute('fill', 'none');
  });
```

Append to the `describe` in `src/components/MainPanel/ModePicker.test.tsx`:

```tsx
  it('renders one side icon per segment, Me and Other in their both form', () => {
    render(<ModePicker mode="both" locked={false} missingDeviceForMode={null} onSegmentClick={() => {}} />);
    const iconIn = (name: RegExp) => screen.getByRole('button', { name }).querySelector('svg')!;
    expect(iconIn(/Me|我/).getAttribute('data-icon')).toBe('side-me');
    expect(iconIn(/Other|对方/).getAttribute('data-icon')).toBe('side-other');
    expect(iconIn(/Both|双向/).getAttribute('data-icon')).toBe('side-both');
    for (const name of [/Me|我/, /Other|对方/]) {
      for (const p of Array.from(iconIn(name).querySelectorAll('path'))) {
        expect(p).toHaveAttribute('fill', 'currentColor');
      }
      expect(iconIn(name).getAttribute('width')).toBe('14');
    }
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/MainPanel/DisplayModeButton.test.tsx src/components/MainPanel/ModePicker.test.tsx`
Expected: the two new tests FAIL — `data-icon` is null (lucide svgs carry no such attribute).

- [ ] **Step 3: Swap the icon in `DisplayModeButton.tsx`**

Replace the import line `import { User, Users } from 'lucide-react';` with:

```tsx
import { SideMeIcon, SideOtherIcon } from '../Icons/SideIcons';
```

Replace `const Icon = scope === 'speaker' ? User : Users;` with:

```tsx
  const Icon = scope === 'speaker' ? SideMeIcon : SideOtherIcon;
```

Replace `<Icon size={14} />` with:

```tsx
      <Icon size={14} mode={value} />
```

- [ ] **Step 4: Swap the icons in `ModePicker.tsx`**

Replace line 3 `import { User, Users, ArrowLeftRight, type LucideIcon } from 'lucide-react';` with:

```tsx
import { SideMeIcon, SideOtherIcon, SideBothIcon } from '../Icons/SideIcons';
```

Replace lines 17–24 (the comment and `SEGMENT_ICONS`) with:

```tsx
// The same three side glyphs the conversation toolbar's DisplayModeButton
// uses, so the footer and the toolbar name Me / Other with one drawing. Here
// they render in their default both form — the picker has no line state.
const SEGMENT_ICONS: Record<'speaker' | 'participant' | 'both', React.ComponentType<{ size?: number }>> = {
  speaker: SideMeIcon,
  participant: SideOtherIcon,
  both: SideBothIcon,
};
```

Line 99 `<Icon size={14} />` stays as it is.

- [ ] **Step 5: Run the tests and the type check**

Run: `npx vitest run src/components/MainPanel src/components/Icons src/components/Subtitle && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; `tsc` reports no errors beyond the baseline; `grep -n lucide src/components/MainPanel/DisplayModeButton.tsx src/components/MainPanel/ModePicker.tsx` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add src/components/MainPanel/DisplayModeButton.tsx src/components/MainPanel/DisplayModeButton.test.tsx src/components/MainPanel/ModePicker.tsx src/components/MainPanel/ModePicker.test.tsx
git commit -m "feat(display-filter): use the side icons in DisplayModeButton and ModePicker"
```

---

### Task 5: Toolbar rest colour `#8a8a8a` from one token

**Files:**
- Modify: `src/styles/_tokens.scss` (append)
- Modify: `src/components/MainPanel/DisplayModeButton.scss:1-4`
- Modify: `src/components/MainPanel/ExportButton.scss:4`
- Modify: `src/components/MainPanel/MainPanel.scss:59,77`
- Modify: `src/components/Subtitle/SubtitleBar.scss:103-105` (comment)
- Test: `src/components/MainPanel/toolbarRestColour.test.ts` (new)

**Interfaces:**
- Produces: `tk.$color-toolbar-icon` = `#8a8a8a`; compiled rules for `.display-mode-btn`, `.export-btn`, `.font-size-btn`, `.clear-conversation-btn` each declare `color: #8a8a8a`; no `color: #555` remains in those three compiled stylesheets.

- [ ] **Step 1: Write the failing stylesheet test**

Create `src/components/MainPanel/toolbarRestColour.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// #510 §3: one rest colour for the whole conversation toolbar. Asserted on the
// compiled CSS, never by reading SCSS source — a token that resolves to the
// wrong value, or a rule that stops reading it, both surface here.
const css = ['DisplayModeButton.scss', 'ExportButton.scss', 'MainPanel.scss']
  .map((f) => compile(resolve(__dirname, f)).css)
  .join('\n');

const TOOLBAR_RULES = ['.display-mode-btn', '.export-btn', '.font-size-btn', '.clear-conversation-btn'];

describe('conversation toolbar rest colour', () => {
  for (const sel of TOOLBAR_RULES) {
    it(`${sel} rests at #8a8a8a`, () => {
      const esc = sel.replace(/\./g, '\\.');
      expect(css).toMatch(new RegExp(String.raw`(?:^|\n)${esc}\s*\{[^}]*\bcolor:\s*#8a8a8a\b`));
    });
  }

  it('no toolbar rule still rests at #555', () => {
    expect(css).not.toMatch(/\bcolor:\s*#555\b/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/MainPanel/toolbarRestColour.test.ts`
Expected: FAIL — the four `#8a8a8a` assertions fail and the `#555` assertion fails.

- [ ] **Step 3: Add the token**

Append to `src/styles/_tokens.scss` (after the `$color-success` line):

```scss

// ── Toolbar chrome ──
// The conversation toolbar's icon buttons at rest — one value for the whole
// row, so the two filter buttons never stand out from their neighbours. 4.83:1
// on the #1e1e1e toolbar (#555 measured 2.24:1, under the 3:1 floor for UI),
// below the conversation's source text (#9aa0a6) so chrome never outranks
// content, and clearly under the #ccc hover / filtering state.
$color-toolbar-icon: #8a8a8a;
```

- [ ] **Step 4: Point the four rules at it**

`src/components/MainPanel/DisplayModeButton.scss` — insert as line 1:

```scss
@use '../../styles/tokens' as tk;

```

and replace `  color: #555;` (inside `.display-mode-btn`) with `  color: tk.$color-toolbar-icon;`.

`src/components/MainPanel/ExportButton.scss` — insert `@use '../../styles/tokens' as tk;` plus a blank line at the top (this file does **not** have it — only `MainPanel.scss` does), then replace `  color: #555;` inside `.export-btn` with `  color: tk.$color-toolbar-icon;`.

`src/components/MainPanel/MainPanel.scss` — replace `  color: #555;` at line 59 (`.clear-conversation-btn`) and at line 77 (`.font-size-btn`) with `  color: tk.$color-toolbar-icon;` (the file already has the `@use` on line 1). Leave every `background: #555` and `border: … #555` alone.

- [ ] **Step 5: Fix the comment in `SubtitleBar.scss`**

Lines 103–105 — replace:

```scss
  // our own .subtitle-bar__btn. Their own SCSS (color: #555) is tuned for
  // MainPanel's lighter toolbar; on the subtitle bar's near-black bg it's
  // nearly invisible. Scoping the override here keeps MainPanel untouched.
```

with:

```scss
  // our own .subtitle-bar__btn. Their own SCSS (tk.$color-toolbar-icon) is
  // tuned for MainPanel's lighter toolbar; on the subtitle bar's near-black bg
  // it's too dim. Scoping the override here keeps MainPanel untouched.
```

- [ ] **Step 6: Run the test, then mutation-check it**

Run: `npx vitest run src/components/MainPanel/toolbarRestColour.test.ts`
Expected: PASS (5 tests).

Mutation check: temporarily change `$color-toolbar-icon: #8a8a8a;` to `#555;` in `_tokens.scss`, re-run — expect all five to FAIL; restore. Then temporarily change `.font-size-btn`'s `color:` back to `#555`, re-run — expect exactly two failures (`.font-size-btn` and the `#555` guard); restore.

- [ ] **Step 7: Full suite and type check**

Run: `npx vitest run 2>&1 | tail -8 && npx tsc --noEmit -p tsconfig.json`
Expected: `Test Files` all passed (count = baseline 334 + 3 new files), 0 failed; the 4 pre-existing "Errors" are unchanged from the baseline on `8a480fd1`; `tsc` reports no errors beyond the baseline.

- [ ] **Step 8: Commit**

```bash
git add src/styles/_tokens.scss src/components/MainPanel/DisplayModeButton.scss src/components/MainPanel/ExportButton.scss src/components/MainPanel/MainPanel.scss src/components/Subtitle/SubtitleBar.scss src/components/MainPanel/toolbarRestColour.test.ts
git commit -m "style(toolbar): rest the conversation toolbar at #8a8a8a from one token"
```

---

## Self-review

**Spec coverage** — #510 §1 (fourth mode): Task 1 type + filter, Task 2 label; the subtitle window gets it through the shared `DisplayModeButton` and `subtitleStore` union. §2 (cycle order): Task 2. §3 (icons carry state, same glyphs on both surfaces, picker shows `both`, recipe, Both never toggles): Tasks 3–4. §3 rest colour, whole row, one variable, picker unchanged: Task 5. "Decided" (both surfaces): Task 4. "Consequence to handle" (no header for a hidden side): satisfied by `MainPanel.tsx:4179-4184` computing `prevItem` from `filteredItems` — no change, recorded in Architecture. "Before it ships": class rename in Task 3 (file + component + README); `width`/`height` are set from `size` in Task 3 (no `24` hard-coded on inline); the blind read is a human step outside this plan. Acceptance: each line maps to a test in Tasks 1–5 except "existing stored three-mode configurations still resolve", which holds because `'none'` is additive and both stores hydrate the raw string (`subtitleStore.ts:202`).

**Placeholder scan** — none; every code step has its code, every run step its command and expected result.

**Type consistency** — `DisplayMode` (Task 1) is the type used by `SideModeIconProps.mode` (Task 3) and `DisplayModeButton.value` (Task 2); `SideMeIcon` / `SideOtherIcon` / `SideBothIcon` names match between Task 3's exports and Task 4's imports; `data-icon` values `side-me` / `side-other` / `side-both` match between Task 3's `Frame` and Task 4's tests; class names `line-source` / `line-translation` / `side-other` / `side-me` match between Task 3's component, the renamed `side-both.svg`, and the drift test; `tk.$color-toolbar-icon` is spelled identically in Task 5's token, rules and comment.
