# Transactions

Wireframe: `../visuals/transactions.svg`. Source audit: feature map §2.

**Layout.** Main list (50%) + detail pane (50%).

**Title bar (main).** Title dropdown `All transactions ▾` (All · each account · saved
views) · `Filter` · `Sort` · search IconButton (inline search field) · `+` (add manual
transaction sheet) · download IconButton (CSV of the current filtered view).

**List.** Day groups (`TODAY`, `YESTERDAY`, `SUN, OCTOBER 18`) with the day's spend total.
`TransactionRow` full variant. Infinite scroll in pages of 100 (`/api/transactions?offset`).
Multi-select via checkboxes → sticky bulk bar at the bottom of the pane: `Categorize ▾`,
`Mark reviewed`, `Tag ▾`, `Exclude`, `Delete`, `n selected`, `×`.

**Filter popover.** Date range (presets + custom) · Accounts (multi) · Categories (tree,
multi) · Tags · Amount min/max · Type (Regular / Income / Internal transfer) · Status
(Pending, Unreviewed, Excluded). Applied filters render as removable chips under the
title bar. **Sort popover.** Date · Amount · Name; direction toggle.

**Detail pane.** TitleBar title = type picker (`Regular transaction ▾`), actions `Split`,
`Recurring`, `…` (Exclude, Mark reviewed, Delete). Body top → bottom:
1. Meta row: calendar icon + long date · right: status (`Pending`).
2. `h1` merchant name (editable on click) · right: `hero-sm` amount (editable).
3. Field grid: `Category` (CategoryTag picker popover with search + tree) · `Account`
   (picker) · `Goal` (+ button) · `Notes` textarea · `Tags` (`# Add tag`).
4. `Similar transactions`: same merchant, grouped by month, month header shows
   `this-account total (all-accounts total)`; compact TransactionRows.

**Data.** `/api/transactions`, `PATCH /api/transactions/:id`, `POST
/api/transactions/review`, `/api/categories`, `/api/accounts`. New: `GET
/api/transactions/:id/similar`, `POST /api/transactions` (manual), `POST
/api/transactions/:id/split`, bulk categorize/tag/exclude routes over `update_transaction`.

**States.** Pending (amount muted), unreviewed (hollow review dot), excluded (row at 60%
opacity, strike on amount), transfer (both legs shown with ⇄ glyph, no category), split
parent (stacked icon, children indented). Empty filter result → EmptyState `No
transactions match.`

**Interactions.** Click row → detail; `↑/↓` move; `R` review; `E` focus category picker;
`⌘A` select all visible; `Esc` clears selection. Edits apply optimistically and write
through (`copilot.pushed` toast: `Saved and pushed to Copilot` / `Saved locally, queued`).

**Acceptance.** 3,000 rows scroll at 60fps (windowed list); every filter round-trips to
the URL hash so a view can be shared/bookmarked.
