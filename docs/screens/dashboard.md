# Dashboard

Wireframe: `../visuals/dashboard.svg`. Source audit: feature map §1.

**Layout.** Main pane only. Two columns (`1.2fr 1fr`), cards stacked with `space-4` gaps.

| # | Region | Component(s) | Data |
| --- | --- | --- | --- |
| L1 | Monthly spending | Card + CardLink(Transactions); centred `hero-sm` `$116 left` / `out of $6,353 budgeted`; cumulative-spend line coloured by pace (`pace-good`→`pace-warn`→`pace-over` along its length), dotted `projection` to month end, end badge ChangeChip(`warn`) `$775 over` or (`up`) `$X under` | `/api/spending/daily`, `/api/budgets` (total) |
| R1 | Assets / Debt | Card + CardLink(Accounts); two StatHero(`hero-sm`) with legend dots (`assets`, `debt`) and ChangeChips; dual line chart; RangeControl (default 1Y) | `/api/networth/history?days` split into assets/liabilities series (extend `netWorthHistory` to return both) |
| L2 | Transactions to review | Card + CardLink(View all → `#/transactions?unreviewed=1`); up to 5 compact TransactionRows, or EmptyState `You’ve reviewed N transactions.` | `/api/transactions?unreviewed=true&limit=5` |
| R2 | Top categories | Card + CardLink(View all → Categories); 6 rows: rank disc (hue of category) · name · spent · BudgetBar · budget | `/api/spending/categories?month` joined with `/api/budgets` |
| L3 | Net this month | Card + CardLink(Cash flow); StatHero `−$3,142.46`, ChangeChip vs same days last month, two-tone bar income (`assets`) vs spend (`debt-tint`), legend | `/api/summary` (+ prev-month same-day comparison: add `compare` to `monthSummary`) |
| R3 | Next two weeks | Card + CardLink(Recurrings); ≤5 RecurringRows (date, name, frequency, account, amount); `Overdue` in `warning` | `/api/recurring?upcoming_days=14` + overdue (next_date < today, unpaid) |
| R4 | Goals | Card + CardLink(All goals); `$0 saved in Oct` + thin bar | `/api/goals` (add route over the goals table) |

**States.** No budget → L1 shows `$6,237 spent in Oct` and no projection badge. No
recurring → R3 EmptyState. First run (no data) → every card EmptyState with a `Sync from
Copilot` button in L1.

**Interactions.** Every CardLink navigates; clicking a Top-categories row opens Categories
with that category in the detail pane; clicking a review row opens Transactions with it
selected.

**Acceptance.** Loads with ≤ 4 API calls (add `/api/dashboard` that bundles them); all
figures agree with the screens they link to.
