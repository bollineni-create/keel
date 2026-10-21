# Investments

Wireframe: `../visuals/investments.svg`. Source audit: feature map §6.

**Layout.** Main + detail. Title bar: `Investments` · `…`; detail: empty title.

**Main.**
1. Portfolio Card: ChangeChip (range change) · `hero` `$60,383` · `live balance estimate`
   · line chart in `positive` · RangeControl (1M default) · cog.
2. `Your top movers for today` (collapsible): horizontal scroller of `TickerCard`s; header
   right `LAST PRICE ▾` (sort: last price / % change / $ change).
3. `Accounts` (collapsible): header right `1M BALANCE CHANGE ▾`; `AccountRow`s with
   absolute ChangeChip (`+$96.96`).
4. `Allocation` (collapsible): header right `BY PERCENTAGE ▾`; rows label · bar · %.

**Detail (security).** `Equity` badge · ChangeChips (`+$12.38`, `↗ 3.04%`) · `TICKER
NAME` `h1` · price `hero-sm` + `Price at 01:00 PM`. Line chart + RangeControl (1D default).
`Positions`: per account — avatar dot · account · updated · shares · value.

**Data.** `/api/holdings`, `/api/accounts?type=investment`, new `/api/investments/summary`
(total + series via holdings × price history), `/api/investments/:security/history`
(from `get_investment_prices` in the Copilot source; live mode gives intraday).

**States.** No price history (cache mode) → sparkline/chart replaced by a flat `projection`
line and the caption `Enable live reads for prices`.

**Acceptance.** Allocation percentages sum to 100 ± 0.1; the portfolio total equals the sum
of investment-account balances.
