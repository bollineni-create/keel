# Accounts

Wireframe: `../visuals/accounts.svg`. Source audit: feature map §5.

**Layout.** Main (50%) + detail (50%). Title bars: `Accounts` · `+`; detail: account type
(`Credit Card`) · `Manage connection` · `…` (hide, rename, set colour, close).

**Main.**
1. Net-worth Card: StatHero pair `● Assets $69,412` (`assets`) / `● Debt $7,334` (`debt`)
   with ChangeChips over the selected range; dual line chart; RangeControl (1Y default);
   cog → chart settings (include hidden accounts).
2. Groups in order: Credit cards · Depository · Investments · Loans · Other. Group header:
   caret · name · info icon; group footer row: ChangeChip (group % change) + group total.
   Rows: `AccountRow` (avatar · name + mask · `Updated 1 day ago` / `Verification needed`
   badge · ChangeChip % · balance). Liabilities display positive (`$5,277.81`) in the
   list, as the source app does; the net-worth math subtracts them.

**Detail.** `DetailHeader` (avatar + mask + updated · ChangeChip; `h1` name; `hero-sm`
balance `/ limit` for credit). Area chart in `debt` (liability) or `assets` (asset) with
RangeControl. Then the account's transactions grouped by month with month totals, compact
`TransactionRow`s, infinite scroll.

**Add account (`+`).** Sheet with three rows: `Connect a bank with Plaid` (opens Plaid Link;
disabled with a hint when `PLAID_CLIENT_ID`/`PLAID_SECRET` are unset) · `Connect with SimpleFIN`
(steps + Setup Token field) · `Import a CSV`. `Manage connection` in the detail pane opens the
account's connection row in Settings; for Plaid, `Fix connection` reopens Link in update mode.

**Data.** `/api/accounts` (rows carry `source`, `connection_id`, `needs_attention`,
`balance_date`), `/api/networth/history` (split series), `/api/accounts/:id/history`
(new: per-account balance_history), `/api/transactions?account_id`, `PATCH /api/accounts/:id`
(`update_account`: rename, type, hide, close), `POST /api/connections/plaid/link-token`,
`POST /api/connections/plaid/exchange`, `POST /api/connections/simplefin`.

**States.** Sync broken (`needs_attention`) → amber `Verification needed` badge and `Manage connection` primary. Hidden accounts
collapsed under `Hidden (3)`. Manual account → `Updated` replaced by `Manual`.

**Acceptance.** Group totals equal the sum of visible rows; detail chart range matches the
RangeControl; clicking a sidebar account lands here with it selected.
