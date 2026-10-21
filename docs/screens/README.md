# Keel screens — build specs for Claude Code

One file per screen. Each spec is the contract: regions in order, the design-system
component each region uses, the data it reads (REST route and MCP tool), its states, its
interactions, and acceptance checks. Wireframes drawn from the tokens are in
`../visuals/<screen>.svg`; the full behavioural audit of the source app is
`../copilot-feature-map.md`; components are documented in the Keel design system
(artifact) and mirrored as classes in `design/` → `web/tokens.css`.

## Build order

1. ✅ **Shell** — three-pane layout, sidebar (nav + MY ACCOUNTS + footer), title bars,
   phone tab bar + detail sheet. Everything else slots into it.
   ✅ **Assistant** — the front door: home route, conversation rail, tool cards, and the
   `⌘J` dock on every other screen. Same tool registry as `/mcp`.
2. ✅ **Transactions** — the densest screen; builds TransactionRow, CategoryTag, Filter/Sort
   popovers, detail pane, bulk bar. Reused by Accounts and Recurrings detail panes.
3. **Dashboard** — composes cards from the other screens' read models.
4. **Accounts** → **Categories** → **Recurrings** → **Investments** → **Cash flow** → **Goals**.
5. **Settings** sheet.

Screens without a ✅ still render their v1 version (`web/v1.js`) inside the shell's main pane.

## Rules that apply to every screen

- Only tokens from `web/tokens.css`; no literal colours, sizes or radii in CSS.
- Desktop ≥ 1100px: sidebar 232 + main + detail (main and detail split the rest 50/50).
  900–1100: detail overlays main as a right sheet. < 900 (phone): tab bar, detail is a
  pushed full-screen sheet with a back button.
- Every list groups by day (transactions) or month (detail panes) with `eyebrow`
  headers and a right-aligned total in `amount-sm` faint.
- Every chart has: a `RangeControl`, `hairline` gridlines, `projection` dotted
  comparison/forecast line where the spec says, and `ink-faint` axis ticks in mono.
- Amount convention: positive = money out. Display flips the sign for income rows
  (`+$3,063.48`, `positive`).
- Loading: skeleton blocks on `bg-200` matching the card's final height (no spinners).
- Keyboard: `⌘K` search, `⌘J` assistant dock, `⌘1…9` nav, `↑/↓` move selection in the focused list,
  `Enter` opens detail, `Esc` closes sheet/popover.
