# Categories (Budget)

Wireframe: `../visuals/categories.svg`. Source audit: feature map §7.

**Layout.** Main + detail. Title bars: `Categories` · `Rebalance` · `+`; detail: `Edit
Budget` · `Turn Off Budgeting`.

**Main.**
1. Summary Card: `$6,237 spent in Oct` (left) · donut of parent categories in their hues
   (centre) · `$6,353 total budget` (right). Month navigation `‹ Oct 2026 ›` in the title
   bar area.
2. Table with eyebrow column headers `REGULAR CATEGORIES · SPENT · BUDGET`. `CategoryRow`
   parents (caret, rank disc in hue, bold name) and children (emoji, indented).
   BudgetBar thresholds per README. Sections below, collapsed by default: `Income`,
   `Internal transfers`, `Excluded`.

**Detail.** Default = `All Regular Categories`; selecting a row scopes it. `DetailHeader`:
name `h1` · right `Spent in Oct $6,236.56` + `$116.44 left` (`positive`/`negative`).
Chip strip of top categories (`+7` overflow). 36-month column chart coloured by pace with
a budget line + `$6,353` label; hover shows month. `Key metrics` table by year (`Spent per
year`, `Avg monthly spend`). `Regular Categories` table: CategoryTag · spent · budget ·
left (signed, coloured).

**Interactions.** Click a budget cell → inline numeric edit → `PUT /api/budgets/:id`.
`Rebalance` → sheet: set total, distribute proportionally, confirm. `+` → new category
sheet (name, emoji, parent, hue). Drag a child onto another parent re-parents it.

**Data.** `/api/budgets?month`, `/api/spending/categories`, `/api/categories`,
`/api/spending/trend?months=36&category_id` (new param), `PUT /api/budgets/:id`.

**States.** Budgeting off → bars hidden, BUDGET column hidden, `Turn On Budgeting` primary.
Category with no spend → `$0` and empty bar (still listed).

**Acceptance.** Parent spent = sum of children + own; totals exclude children whose parent
is budgeted (no double count — `budgetStatus()` already does this).
