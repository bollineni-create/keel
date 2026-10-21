# Recurrings

Wireframe: `../visuals/recurrings.svg`. Source audit: feature map §8.

**Layout.** Main + detail. Title bars: `Recurrings` · `+`; detail: `Monthly recurring` · `…`.

**Main.**
1. Summary Card: `$31 left to pay` · ring (paid ÷ (paid+left), `assets` on `assets-tint`)
   · `$3,810 paid so far`.
2. `This month` (collapsible): `RecurringRow`s sorted by date; `Overdue` first in
   `warning`. Status check: `positive` posted, `cat-5` pending, none unpaid.
3. `In the future` (collapsible): next 60 days.
4. Paused/archived under `Paused (n)` collapsed.

**Detail.** CategoryTag · emoji + name `h1` · right `NEXT PAYMENT $2,813.91 around Nov
2nd`. `RULES`: RuleChips (`Named …`, `From $x to $y`, `on any day of the month`, `every
month`) — click to edit in a popover. Line chart of the last 12 payments in `debt`
(income recurrings in `positive`) with dotted projection. `Key metrics` by year. `Last
account used` AccountRow. `Transactions` list (date · name · account · tag · amount · ×
unlink) with `ADD` (search picker). `Transactions excluded` list with `+` re-include.

**Data.** `/api/recurring`, `/api/recurring/:id` (new: with linked transactions, history,
metrics), `PATCH /api/recurring/:id` (rules, state), link/unlink via `update_transaction
{recurring_id}`. Paid state = a linked transaction exists with date in the current cycle.

**States.** No recurrings → EmptyState + `Detect from transactions` button (runs the
pattern detection from the Copilot source in cache mode). Paused rows muted.

**Acceptance.** `paid so far + left to pay` equals the month's expected total; overdue
logic uses `next_date < today && !paid`.
