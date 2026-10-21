# Copilot Money → Keel: functional map

A screen-by-screen specification of the Copilot Money Mac app (v. Oct 2026), captured from
the live app, written so Claude Code can rebuild each screen in Keel with the same
information architecture, controls, states and interactions. Brand (name, logo, mark,
Copilot's proprietary icon glyphs) is **not** reproduced; Keel uses its own name and the
Lucide icon set in the same roles. Category emoji are Unicode and come through with the data.

Each screen below lists: **Layout** · **Regions** (top→bottom, left→right) · **Controls** ·
**States** · **Interactions** · **Data** (Keel API / tool that feeds it).

---

## 0. Shell (every screen)

**Layout.** Three panes on desktop: a 232px **sidebar**, a **main** pane, and (on
Transactions, Accounts, Investments, Categories, Recurrings) a **detail** pane of equal
width to the right. Main and detail each have a 44px **title bar** with the screen name
left and actions right. Phone: sidebar becomes a 5-tab bar; detail pane becomes a pushed
sheet.

**Sidebar regions.**
1. Window controls row: back / forward / refresh (top-right of sidebar).
2. **Search** field (full width, `⌘K`): global search across transactions, accounts, categories, recurrings.
3. **Primary nav**: Dashboard · Transactions · Goals · Cash flow · Accounts · Investments · Categories · Recurrings. Active item has a tinted pill background.
4. **MY ACCOUNTS** eyebrow, then collapsible groups by account type (Credit cards, Depository, Investments, Loans, …). Each group row: disclosure caret + group name. Each account row: colored dot (institution/account color) · name · balance right-aligned, mono, abbreviated (`$5,278`). Closed/hidden accounts are greyed. Click → Accounts screen with that account in the detail pane.
5. Footer: **Start here** (onboarding checklist, orange dot while incomplete) · **Get help** · **Settings** (opens a right-side sheet; §9).

**Title-bar conventions.** Screen name in 15/600 at left; icon buttons at right; a `+` button creates the screen's primary object; `…` opens an overflow menu. Buttons are 28px tall, hairline border, 8px radius.

**Global states.** Loading skeleton per card; empty states are centered illustration + one sentence (`Your goals will appear here after you create them.`); errors inline under the title bar.

---

## 1. Dashboard

**Layout.** Two-column card grid in main (no detail pane). Left column wider (≈55/45).

**Regions.**
1. **Monthly spending** card (L1). Header: title + `TRANSACTIONS ↗` link. Hero: `$116 left` / `out of $6,353 budgeted` centered. Chart: cumulative month-to-date spend line coloured by pace (green → yellow → red as it approaches/passes budget), dotted grey projection line to month end, an end-of-line badge `$775 over` in red (or `$X under` in green).
2. **Assets / Debt** card (R1). Two legend stats with change chips (`↗ 33.65%`), `ACCOUNTS ↗` link. Dual-line chart (assets blue, debt orange) with end dots. Range segmented control: `1W 1M 3M YTD 1Y ALL`.
3. **Transactions to review** card (L2). `VIEW ALL ↗`. Empty state: badge illustration + `You've reviewed 3,027 transactions.` Non-empty: up to 5 unreviewed rows (TransactionRow, compact) + count.
4. **Top categories** card (R2). `VIEW ALL ↗`. Rows: rank number in a coloured disc · category name · spent (mono) · progress bar (green/orange/red by % of budget) · budget (mono). Top 6 parent categories by spend.
5. **Net this month** card (L3). `CASH FLOW ↗`. `-$3,142.46` hero; chip `↘ 33.05%` + `vs -$2,361.77 in Sep 1 – Sep 20, 2026`. Income vs spend as a two-tone horizontal bar; legend `Income $3,063.48` / `Spend $6,205.94`.
6. **Next two weeks** card (R3). `RECURRINGS ↗`. Rows: date (or `Overdue` in amber) · emoji + name · frequency · account · amount. Max 5.
7. **Goals** card (R4). `ALL GOALS ↗`. `$0 saved in Oct` + thin progress bar.

**Data.** `get_overview`, `get_spending_trend`, `get_net_worth_history`, `get_transactions {unreviewed}`, `get_spending_by_category`, `get_recurring {upcoming_days:14}`, goals table.

---

## 2. Transactions

**Layout.** Main list + detail pane.

**Title bar (main).** `All transactions` (dropdown: All / per-account / saved views) · `Filter` · `Sort` · search icon · `+` (add manual transaction) · download icon (export CSV of current view).

**List.** Grouped by day with sticky day headers (`TODAY`, `YESTERDAY`, `SUN, OCTOBER 18`). Each **TransactionRow**: checkbox (multi-select) · review-state glyph (filled when reviewed) · merchant name (bold) · account name + mask (muted) · **CategoryTag** (emoji + UPPERCASE name on a tinted pill, colour per category) right-aligned · amount (mono; income in green with `+`). Pending rows show italic/greyed amount. Selecting rows reveals a bulk bar: categorize, review, tag, exclude, delete.

**Filter popover.** Date range · accounts · categories · tags · amount range · type (regular / income / internal transfer) · status (pending, reviewed, excluded). **Sort popover.** Date, amount, name; asc/desc.

**Detail pane (selected transaction).** Title bar: `Regular transaction` (type picker: Regular · Income · Internal transfer) · `Split` · `Recurring` (link to a recurring series) · `…` (exclude, delete, mark reviewed). Body: date · status (`Pending`) · merchant name (editable h1) · amount (editable, mono, large) · **Category** picker (tag) · **Account** picker (tag with institution dot) · **Goal** (+) · **Notes** textarea · **Tags** (`Add tag`). Then **Similar transactions**: grouped by month with month totals (`$76.39 ($103.72)` = this account / all), rows reuse TransactionRow compact.

**Interactions.** Click row → detail; `⌘↑/↓` moves selection; `R` toggles reviewed; `E` edit category; drag select; keyboard filter `F`.

**Data.** `get_transactions`, `update_transaction`, `review_transactions`, `get_categories`, `get_accounts`.

---

## 3. Goals

**Layout.** Main only. Title bar: `Goals` · `Add a goal`.

**Summary card.** `$0 saved in Oct` left · ring chart centre · `$0 to go in Oct` right · settings cog top-right.

**Goal list.** Each GoalCard: emoji · name · target · saved · monthly contribution · linked account · progress ring. Empty state sentence.

**Data.** goals table (`get_goals` cache-only in the Copilot source).

---

## 4. Cash flow

**Layout.** Main only. Title bar: `Cash flow` · period chips (`Year to date` · `Jan 1, 2026 – Oct 20, 2026 ▾`) · `compared to` · `Previous period ▾` · right: `Show excluded spend` toggle.

**Regions.**
1. **Net income** card (full width). `VIEW MORE ↗`. Period label · hero `-$34,356.05` · change chip + `vs -$56,415.32 in Jan 1 – Oct 20, 2025`. Column chart: one bar per month, green above 0 / red below, dotted comparison line, `Now` marker, y-axis `$0 / -$24K`.
2. **Spend** card (L). Hero + chip. Stacked columns per month, segments coloured by category, dotted comparison line.
3. **Income** card (R). Hero + chip. Blue columns per month, dotted comparison line.

**Data.** `get_spending_trend {months}` extended with per-category stacks; comparison = previous period.

---

## 5. Accounts

**Layout.** Main list + detail pane. Title bar: `Accounts` · `+` (add account / manual).

**Main.**
1. **Net worth card**: `Assets $69,412` (blue) · `Debt $7,334` (orange) with change chips; dual line chart; range control; cog.
2. **Account groups** (Credit cards, Depository, Investments, Loans, Other): group header with caret + name + info icon; group total row (change chip + sum). Each **AccountRow**: institution avatar (logo disc) · name · mask · `Updated 1 day ago` (muted, second line) · change chip (`↗ 94.24%` green / `↘` red / `= 0.00%` grey) · balance (mono). `Verification needed` badge in amber when sync broke.

**Detail pane (selected account).** Title bar: account type (`Credit Card`) · `Manage connection` · `…`. Header: avatar + mask + `Updated 1 day ago` · change chip; name h1; balance `$5,277.81 / $5,600.00` (limit for credit). Area chart (orange for debt, blue for assets) with range control. Then **transactions for that account** grouped by month with month totals.

**Data.** `get_accounts`, `get_net_worth_history`, `get_transactions {account_id}`, balance_history per account.

---

## 6. Investments

**Layout.** Main + detail. Title bar: `Investments` · `…`.

**Main.**
1. **Portfolio card**: change chip `↗ 0.48%` · hero `$60,383` · `live balance estimate` · green line chart · range control (`1W 1M 3M YTD 1Y ALL`, 1M default) · cog.
2. **Your top movers for today**: horizontally scrolling TickerCards: ticker · name · sparkline · change chip. Header right: `LAST PRICE ▾` sort.
3. **Accounts**: header `1M BALANCE CHANGE ▾`. Rows: institution avatar · name · mask · `Updated` · change chip (absolute `+$96.96`) · balance.
4. **Allocation**: header `BY PERCENTAGE ▾`. Rows: label (Equity / ETF / Other / …) · bar · percent.

**Detail pane (selected security).** `Equity` badge · change chips (`+$12.38`, `↗ 3.04%`) · `UNH UNITEDHEALTH GROUP INCORPORATED` h1 · price + `Price at 01:00 PM`. Line chart with range control. **Positions**: account · `Updated` · shares · value.

**Data.** `get_holdings`, investment prices/history (live tools), `get_accounts {type: investment}`.

---

## 7. Categories (Budget)

**Layout.** Main + detail. Title bar: `Categories` · `Rebalance` · `+`. Detail title bar: `Edit Budget` · `Turn Off Budgeting`.

**Main.**
1. **Summary card**: `$6,237 spent in Oct` · donut (segments per parent category colour) · `$6,353 total budget`.
2. **Regular Categories** table: columns `SPENT` · bar · `BUDGET`. Parent row: caret · rank disc · name · spent · bar · budget. Child rows indented with emoji. Bars green/orange/red by % used. Sections: Regular Categories, then (collapsed) Income, Internal transfers, Excluded.

**Detail pane (All Regular Categories, or one category).** Header: name h1 · `Spent in Oct $6,236.56` · `$116.44 left`. Category chips row (top 6 + `+7`). Monthly columns chart (36 months, green/yellow/red by budget pace) with a `$6,353` budget line label. **Key metrics** table: per year `Spent per year` · `Avg monthly spend`. **Regular Categories** table: tag · spent · budget · left (green `+` / red `-` with arrows).

**Interactions.** Click budget cell → inline edit; `Rebalance` redistributes to match total; drag categories to re-parent.

**Data.** `get_budgets`, `get_spending_by_category`, `set_budget`, `get_categories`.

---

## 8. Recurrings

**Layout.** Main + detail. Title bar: `Recurrings` · `+`.

**Main.**
1. **Summary card**: `$31 left to pay` · ring (paid / total) · `$3,810 paid so far`.
2. **This month** (collapsible): rows date (`Oct 2nd`, `Overdue` in amber) · emoji + name · frequency · CategoryTag · amount · check (green when paid; pink when pending).
3. **In the future** (collapsible): same rows, next 30+ days.

**Detail pane (selected recurring).** CategoryTag · name h1 · `NEXT PAYMENT $2,813.91 around Nov 2nd`. **Rules** chips: `Named Yesler` · `From $0 to $25,771.50` · `on any day of the month` · `every month`. Line chart of past payments (12 months) with dotted projection. **Key metrics** by year (`Spent per year`, `Avg transaction`). **Last account used** row. **Transactions** list (date · name · account · tag · amount · ×) with `ADD`. **Transactions excluded** list (`+` to re-include).

**Data.** `get_recurring`, recurring↔transaction links, `update_transaction {recurring_id}`.

---

## 9. Settings (right sheet)

Sections: **Demo mode** · **Features** (Budgeting toggle, Tags ›) · **Connections** (Manage your connections ›) · **Appearance** (Dark mode: Automatic / Light / Dark) · **Copilot Labs** (Amazon, Venmo) · **Notifications** (Bank fee alert, Big expense alert, Budgets updates, Credit utilization alert, Income update, Low balance alert, Recurring paid alert, Spending update, Uncategorized transfer alert — toggles) · **Rollovers** (Enable rollovers) · Account / Export / Sign out.

Keel equivalents: Bank connections (Plaid / SimpleFIN, the Connections › equivalent) · Data (sync, CSV import, write-through mode) · Assistant (API key status, model) · Appearance · Notifications (reuse list; delivered via the assistant/MCP) · MCP connection instructions.

---

## 10. Cross-cutting components (what the design system must provide)

| Component | Where | Notes |
| --- | --- | --- |
| NavItem | sidebar | icon + label; active = tinted pill, brand-coloured text |
| AccountNavRow | sidebar | colour dot · name · abbreviated balance |
| TitleBar | every pane | 44px; name left; IconButton / Button right |
| Card | all screens | white on grey ground, hairline, 12px radius, 16px padding; `CardLink` (UPPERCASE 11/600 + ↗) at top-right |
| StatHero | dashboard, cash flow, categories | big mono figure + caption + ChangeChip |
| ChangeChip | everywhere | `↗ 33.65%` green / `↘` red / `=` grey; tinted pill, 11/600 |
| RangeControl | charts | segmented `1W 1M 3M YTD 1Y ALL` |
| LineChart / AreaChart / ColumnChart / StackedColumnChart / Donut / Ring / Sparkline | all | see tokens `chart.*` |
| TransactionRow (full, compact) | transactions, details | checkbox · review glyph · name · account · CategoryTag · amount |
| CategoryTag | everywhere | emoji + UPPERCASE 10/700, tinted pill in the category's hue |
| BudgetBar | categories, dashboard | 6px bar, green <80%, orange 80–100%, red >100% |
| AccountRow | accounts, investments | avatar · name · mask · updated · ChangeChip · balance |
| RecurringRow | recurrings, dashboard | date · emoji · name · frequency · tag · amount · status check |
| TickerCard | investments | ticker · name · sparkline · ChangeChip |
| RuleChip | recurring detail | `Named **Yesler**` style |
| DetailHeader | detail panes | badge row · h1 · hero amount · meta |
| Toggle, Select, DateRangePicker, Popover, Sheet | forms, settings | |
| EmptyState | lists | illustration disc + sentence |
