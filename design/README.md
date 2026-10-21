# Daybook

Daybook is the design system for Naren's self-hosted money app — a functional twin of
Copilot Money's Mac app (same screens, panes, rows, charts and workflows; see the repo's
`docs/copilot-feature-map.md`) with its own name, palette and icon set. One person uses it
on a Mac and a phone, with a Claude assistant and an MCP endpoint built in. This system
exists so every screen Claude Code builds lands in the same place.

## Principles

1. **Three panes, one rhythm.** Sidebar (`sidebar-w` 232px) · main · detail. Every pane
   starts with a 44px TitleBar (`titlebar-h`). Main and detail scroll independently.
   Content is a vertical stack of Cards on the `bg-000` ground; inside a card, rows.
2. **Light first.** The ground is cool grey (`bg-000` `#f5f6f8`), cards are white
   (`bg-100`) with a `hairline` border and `shadow-card`. Dark is a full peer with the same
   token names; never ship a screen that only works in one.
3. **Figures in mono, colour means direction.** Every amount is `amount` (mono, tabular).
   `positive` green = income, up, paid, under budget. `negative` red = over, down,
   overdue, delete. `warning` amber = near budget, overdue label, needs attention. Grey
   `neutral-chip` = flat. Assets are `assets` blue and debt is `debt` orange on every
   chart, no exceptions.
4. **Tags carry the category.** A CategoryTag is emoji + UPPERCASE `tag` text on a tinted
   pill in one of twelve hues (`cat-1`…`cat-12` with `-tint`). The hue is assigned per
   parent category and inherited by its children; it is the same hue in every row, chart
   segment and donut slice for that category.
5. **Dense, quiet rows.** Rows are 40px (`row-h`), two-line rows 52px; separators are
   `hairline`; hover is `bg-200`; selection is `brand-tint`. Nothing bold except the
   primary text and the amount.

## Colour

| Role | Token | Light | Dark |
| --- | --- | --- | --- |
| Ground / card / field | `bg-000` / `bg-100` / `bg-200` | `#f5f6f8` / `#fff` / `#eef0f3` | `#0f1216` / `#171b21` / `#1f252c` |
| Divider | `hairline` | `#e6e8ec` | `#2a323c` |
| Text | `ink` / `ink-muted` / `ink-faint` | | |
| Brand / active nav / links | `brand` (+ `brand-tint`) | `#117a58` | `#3ccf9a` |
| Up / income / paid | `positive` (+ tint) | `#15803d` | `#4ade80` |
| Down / over / overdue | `negative` (+ tint) | `#dc2626` | `#f87171` |
| Near limit / attention | `warning` (+ tint) | `#d97706` | `#fbbf24` |
| Assets · Debt | `assets` · `debt` (+ tints) | `#2f6fed` · `#f97316` | |
| Spending pace | `pace-good` → `pace-warn` → `pace-over` | green → amber → red | |
| Projection / comparison | `projection` | dotted grey | |
| Category hues | `cat-1`…`cat-12` + `-tint` | | |

Rules:
- Body text `ink`; secondary `ink-muted`; `ink-faint` only for ticks and placeholders.
- Amounts stay `ink`; only income (`+$3,063.48`) is `positive`, only over/overdue is
  `negative`. A wall of coloured numbers is noise.
- Budget bars: `pace-good` under 80%, `pace-warn` 80–100%, `pace-over` past 100%, track
  `bg-200`. The monthly-spending line changes colour along its length by the same rule.
- Charts: assets `assets`, debt `debt`, income columns `assets`, net income columns
  `positive`/`negative` by sign, spend stacks in category hues, comparison period as a
  dotted `projection` line, a `Now` marker in `ink-faint`.

## Type

Inter for UI, IBM Plex Mono for figures (Google Fonts: `Inter:wght@400;500;600`,
`IBM+Plex+Mono:wght@500;600`).

`h1` 22/28 (detail titles) · `title` 15/20 (title bars) · `h2` 15/20 (card titles) ·
`body` 13/18 500 (row text, nav) · `body-sm` 12/16 (captions) · `eyebrow` 11/14 600
uppercase 0.06em (MY ACCOUNTS, CardLink, column headers) · `tag` 10/14 700 uppercase ·
`hero` 28/32 mono (big figures) · `hero-sm` 20/24 mono · `amount` 13/18 mono 600 ·
`amount-sm` 11/14 mono.

Money: `$1,234.56`; abbreviated in the sidebar (`$5,278`); change always signed
(`+$96.96`, `−$42.12`, true minus). Percentages one decimal in chips (`33.65%`), none in
budget bars.

## Spacing and radius

4px grid. `space-1` 4 · `space-2` 8 · `space-3` 12 · `space-4` 16 · `space-5` 24 ·
`space-6` 32. Cards `radius-lg` 12; nav pill and popovers `radius-md` 8; inputs and
buttons `radius-sm` 6; tags, chips, bars, avatars `radius-pill`.

## Iconography

Lucide icons, 1.5px stroke, 16px in rows and title bars, 18px in the sidebar nav, 22px in
the phone tab bar, `currentColor`. Nav icon map: Dashboard `layout-dashboard` ·
Transactions `list` · Goals `flag` · Cash flow `arrow-left-right` · Accounts `landmark` ·
Investments `trending-up` · Categories `tags` · Recurrings `repeat` · Settings `settings`
· Start here `rocket` · Get help `circle-help`. Institution avatars are 24px discs showing
the institution logo when the data has one, else the first letter on `bg-300`. Category
emoji come from the data and are never replaced.

**App icon.** A solid white **D** on `brand`, with two short rounded lines cut out of it: a
daybook's first entries. One flat shape, no outlines or frames. It always uses light-theme
`brand` (`#117a58`), in both themes, because dark `brand` is too pale behind white. The Mac app
draws the same mark in the macOS squircle. The master is `web/icon.svg` in the repo;
`app/macos/make_icon.swift` redraws it for macOS.
(The app was called Keel until October 2026.)

## Components

Live previews live under Components. Each has a README with its anatomy and rules. The
set: TitleBar · NavItem · AccountNavRow · Card · CardLink · StatHero · ChangeChip ·
RangeControl · CategoryTag · TransactionRow · BudgetBar · CategoryRow · AccountRow ·
RecurringRow · TickerCard · RuleChip · DetailHeader · EmptyState · Toggle · Button.

Composition per screen is in the repo under `docs/screens/`; the wireframes under
`docs/visuals/` are drawn from these tokens.

## Voice

Short and specific. Card links are verbs or nouns in eyebrow caps with an arrow
(`VIEW ALL ↗`). Empty states are one sentence that says what will fill the space.
The assistant says what the number means: "You've spent $6,237 of $6,353 — $116 left
with 10 days to go."

## Code

The app lives at https://github.com/bollineni-create/keel. `design/tokens.json` in the
repo is a verbatim copy of this system's `tokens.json` and `design/README.md` of this
file; `npm run tokens` generates `web/tokens.css`, and app CSS uses only those variables.
To change the design: edit this system here, copy `tokens.json` and this README into the
repo's `design/` folder, run `npm run tokens` (the repo's CLAUDE.md spells out the steps).
