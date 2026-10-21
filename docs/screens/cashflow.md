# Cash flow

Wireframe: `../visuals/cashflow.svg`. Source audit: feature map §4.

**Layout.** Main only. Title bar: `Cash flow` · period preset chip (`Year to date`,
`This month`, `Last 12 months`, custom) · date range dropdown · `compared to` · comparison
dropdown (`Previous period`, `Same period last year`, none) · right: `Show excluded
spend` Toggle.

**Regions.**
1. `Net income` Card (full width): StatHero (period label, `hero` figure, ChangeChip + `vs
   … in <comparison period>`), column chart per month — `positive` above zero,
   `negative` below — dotted comparison line, `Now` marker, `$0` and min tick labels.
2. `Spend` Card (left): StatHero (chip inverted: lower spend is `up`), stacked columns per
   month by parent-category hue, dotted comparison line.
3. `Income` Card (right): StatHero in `positive`, columns in `assets`, dotted comparison.

**Interactions.** Hover a column → tooltip with month, value, comparison value; click →
Transactions filtered to that month (and category segment for Spend). `VIEW MORE ↗`
expands the card to full width with a per-category legend table.

**Data.** `/api/spending/trend?months&start&end&compare` (extend to return per-category
stacks, income, net, and the comparison series).

**Acceptance.** Net = income − spend per month exactly; toggling excluded spend changes
Spend and Net but never Income.
