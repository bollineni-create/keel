# Keel

Keel is the design system for Naren's self-hosted money app: a Copilot-Money-class
personal finance tool (accounts, transactions, budgets, recurring, investments, net
worth) with a Claude assistant and an MCP endpoint built in. One person uses it, on a
Mac and a phone, many times a day. The system exists so every screen, chart and
assistant reply looks like one product.

## Principles

1. **Figures first.** The number is the content. Amounts are set in the mono family
   (`amount`, `amount-xl`) with tabular digits so columns line up; everything around a
   number is quieter than the number.
2. **Dark is home.** The app is dark-first (`bg-000` `#0d1014`). Light is a full
   peer, not an inversion: the light ground is warm paper (`#f4f3ee`), never pure
   white, and white is reserved for cards (`bg-100`).
3. **Borders, not shadows.** Surfaces are separated by one step of ground
   (`bg-000` → `bg-100` → `bg-200`) and a `hairline`. The only shadow in the system is
   `shadow-pop`, for popovers and the assistant sheet.
4. **Three meanings, three hues.** `brand` green = positive / income / on-track.
   `spend` coral = spending / negative / over. `amber` = attention (pending,
   unreviewed, nearly spent, stale sync). They differ in lightness as well as hue, so
   they survive colour-blindness and a dark/light flip.
5. **Dense but breathable.** Rows are 12px tall-padded (`space-3`), cards 16px
   (`space-4`). The phone layout is the desktop layout with the sidebar folded into a
   bottom tab bar; no screen gets a different information architecture per device.

## Colour

| Role | Token | Dark | Light |
| --- | --- | --- | --- |
| Ground | `bg-000` | `#0d1014` | `#f4f3ee` |
| Card | `bg-100` | `#151a20` | `#ffffff` |
| Field / hover | `bg-200` | `#1d242c` | `#ebe9e2` |
| Divider | `hairline` | `#2a323c` | `#d6d3c9` |
| Text | `ink` / `ink-muted` / `ink-faint` | | |
| Positive / primary | `brand` | `#3ccf9a` | `#117a58` |
| Spend / negative | `spend` | `#ff7a66` | `#c23d2a` |
| Attention | `amber` | `#f2b64f` | `#8a5a00` |
| Chart series 2 / 3 | `sky` / `violet` | | |

Rules:

- Body text is `ink` on `bg-000` or `bg-100`; `ink-muted` is for the second line of a
  row. `ink-faint` never carries information a person must read.
- An amount is coloured only when its sign matters: income rows and positive change
  in `brand`, spending that is over budget or negative change in `spend`. Ordinary
  spending rows stay `ink` — a wall of coral is noise.
- Budget bars: `brand-tint` track with a `brand` fill up to 80%, `amber` from 80–100%,
  `spend` past 100% on a `spend-tint` track.
- Charts: series 1 `brand`, series 2 `sky`, series 3 `violet`; spend-vs-income bars
  use `spend` and `brand`. Gridlines are `hairline`; ticks are `ink-faint` in
  `mono-sm`.

## Type

Inter for UI, IBM Plex Mono for figures. Both are hosted faces (Google Fonts); the
app loads `Inter:wght@400;500;600` and `IBM+Plex+Mono:wght@400;500`.

- `display` 40/44 600 — the brand name and one headline label per screen.
- `h1` 24/30 — screen titles. `h2` 17/22 — card titles.
- `body` 15/22, `body-sm` 13/18 — rows and captions. `label` 12/16 600 uppercase,
  0.04em — eyebrows and nav.
- `amount-xl` 36/40 mono — the single hero figure. `amount` 15/22 mono — every
  other number. `mono-sm` 12/16 — masks, tickers, axis ticks.

Numbers are formatted `$1,234.56`; change is always signed (`+$120.00`, `−$42.17`)
using a true minus (U+2212). Percentages carry one decimal.

## Spacing and radius

A 4px grid: `space-1` 4 · `space-2` 8 · `space-3` 12 · `space-4` 16 · `space-5` 24 ·
`space-6` 32 · `space-8` 48. Radii: `radius-sm` 6 (chips, inputs), `radius-md` 10
(buttons), `radius-lg` 16 (cards, sheets), `radius-pill` for bars and segmented
controls.

## Iconography

Outline icons at 1.5px stroke, 20px on desktop, 24px in the phone tab bar, drawn in
`currentColor`. Category icons sit in a 32px disc of `bg-200` (or the category's
tint when it has one). No emoji in UI chrome; category emoji are allowed only where
the person chose one in the source app.

## Components (conventions)

- **Row** — 56px: 32px icon disc · name (`body`) over meta (`body-sm`, `ink-muted`) ·
  amount (`amount`) right-aligned. Pending rows show an `amber` dot before the meta.
- **Card** — `bg-100`, 1px `hairline`, `radius-lg`, `space-4` padding, `h2` title
  with an optional `label` eyebrow above it.
- **Stat tile** — eyebrow `label` in `ink-muted`, figure in `amount-xl`, change line
  in `body-sm` coloured by sign.
- **Budget bar** — 8px `radius-pill` bar, label row above, "spent of limit" in
  `body-sm` to the right.
- **Assistant** — messages in `body`; the assistant's turn sits on `brand-tint`
  (dark) / `bg-200` (light); tool calls render as a collapsed `mono-sm` line.
- **Nav** — desktop: 232px sidebar on `bg-100`; phone: five-tab bar (Home,
  Transactions, Budgets, Accounts, Assistant). Active item in `brand`.

## Voice

Short, specific, no exclamation marks. The assistant says what it did and what the
number means: "You've spent $1,240 of $1,500 on dining — 83%, with 11 days left."
