# Cubes — Design & Brand Guidelines

The product's brand is **Cubes** — one workspace built from many blocks:
projects, docs, video review, social, reporting. The identity leans on the
cube metaphor everywhere (logo, hero cube-field, App Center "Cubes Apps").

---

## 1. Logo

### The mark
An **isometric cube** drawn from three faces of one colour at stepped opacities
(top 100% · left 68% · right 42%), which makes it read 3-D on any background.

- Vector source of truth: [`src/components/brand/cubes-logo.tsx`](src/components/brand/cubes-logo.tsx)
  — `CubesMark` (mark only) and `CubesLogo` (mark + wordmark).
- Static files: [`public/brand/cubes-mark.svg`](public/brand/cubes-mark.svg)
  (indigo) and `cubes-mark-white.svg` (reverse).
- Favicon / app icon: [`src/app/icon.svg`](src/app/icon.svg) — white cube on a
  rounded indigo tile.

### The wordmark
"**Cubes**" set in Geist Sans, weight 800, letter-spacing −0.02em, beside the
mark with an 8–10px gap. Don't re-set it in another typeface.

### Usage
| Surface | Treatment |
|---|---|
| App sidebar / auth screens | White mark on the indigo gradient tile + "Cubes" |
| Landing nav & footer | Same tile treatment |
| Light documents | Indigo mark (`cubes-mark.svg`) |

Don't rotate, outline, or recolour the mark outside indigo/white.

---

## 2. Colour
| Token | Hex | Use |
|---|---|---|
| **Indigo** (primary) | `#4A4AD0` | Brand, primary actions, active states (AntD `colorPrimary` in [`src/lib/theme.ts`](src/lib/theme.ts)). |
| Indigo Light | `#6A6AE0` | Gradient partner on brand tiles. |
| Hero spectrum | blue `#467CF` → lavender → violet → magenta → pink `#FF6EC8` | The landing cube-field ramp only — not a UI palette. |
| Ink | `#141A2E` | Headline text on light. |
| Silver | `#A4B0CA→#C7CFE2` | Muted headline words on the landing. |

Semantic: success `#2F8F5F` · warning `#B8842A` · danger `#C0453C`.

## 3. Typography
**Geist Sans** for UI/headings, **Geist Mono** for numerals/IDs, **Material
Symbols Rounded** (300) for icons. Landing headlines: 800 weight, −0.04em.

## 4. Signature motif — the cube field
The landing hero's staircase of glassy gradient cubes (with 4-point sparkle
stars at junctions) is the brand's signature graphic. It is **static** (no
physics/interaction). Recreate it only via the `CubeField` component in
[`src/app/page.tsx`](src/app/page.tsx); keep the blue→pink left-to-right sweep.

## 5. Voice
Confident, plain-spoken, a little playful. Tagline: **"Everything your team
ships, in one place."** Naming: the workspace is "Cubes"; first-party apps are
"Cubes Apps".
