# Theme selector — millions of colors

Two files:

- `src/lib/theme.ts` — color math (hex ⇄ HSL), contrast-safe foreground text,
  and functions to apply/save/load/reset the theme.
- `src/components/app/ThemeCustomizerCard.tsx` — the Settings card itself:
  two color-wheel swatches (Accent, Background), a live preview, and Reset.

## 1. Install the color wheel dependency

```bash
npm install react-colorful
```

(~2.8kb, no other deps — this is what renders the actual HSL wheel with
unlimited color choice, not a fixed swatch grid.)

## 2. Confirm you have a `Popover` shadcn component

The card uses `@/components/ui/popover`. If it's not already in your project:

```bash
npx shadcn@latest add popover
```

(You already have `Card`, `Button`, and presumably `Label` from the rest of
the Settings page — same pattern as `ArchiveCard.tsx`.)

## 3. Drop the two files in

Copy `theme.ts` into `src/lib/` and `ThemeCustomizerCard.tsx` into
`src/components/app/` (or wherever your other Settings cards live).

## 4. Restore the saved theme on app start

In your top-level `App.tsx` (or `main.tsx`), call `initTheme()` once before
or on first render:

```tsx
import { initTheme } from "@/lib/theme";

// top of App.tsx, outside the component, or in a useEffect(() => initTheme(), [])
initTheme();
```

This re-applies whatever color the user last picked, so a refresh or app
restart doesn't reset to default.

## 5. Add the card to your Settings page

```tsx
import { ThemeCustomizerCard } from "@/components/app/ThemeCustomizerCard";

// alongside your other settings cards, e.g. next to ArchiveCard
<ThemeCustomizerCard />
```

## How it works

- Colors are stored as shadcn-style HSL strings (`"221 83% 53%"`, no `hsl()`
  wrapper) in `localStorage` under the key `app-custom-theme` — same pattern
  as your other local settings.
- Picking a color sets `--primary` / `--background` (and derived
  `--primary-foreground` / `--foreground` / `--ring`) directly on
  `document.documentElement`, which every shadcn/Tailwind component already
  reads from — so buttons, active nav states, badges, etc. update instantly
  with no per-component changes needed.
- `readableForeground()` computes WCAG relative luminance on whatever color
  is picked and flips text to near-black or near-white automatically, so a
  very light accent or background never produces unreadable text.
- Works identically in the web build and the Tauri desktop build — it's
  plain CSS variables + localStorage, nothing platform-specific.

## Optional next step

If you also want light/dark mode as a separate toggle (independent of the
custom accent color), that's a bigger change — happy to build that too, but
it typically means switching your CSS variable set based on a `.dark` class
on `<html>`, which needs your current `index.css` to wire correctly.
