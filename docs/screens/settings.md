# Settings (sheet)

Source audit: feature map §9. Opens from the sidebar footer as a right sheet
(`shadow-pop`), 420px, `×` to close.

**Sections (Toggle rows, 36px).**
- **Bank connections** — one row per connection (Plaid Item or SimpleFIN token): avatar ·
  institution · status chip (`Connected` / `Verification needed` amber / `Error`) · provider ·
  account count · `synced 2 h ago` · error text when not ok · `Sync` (or `Fix connection`
  primary when it needs a new login) · `…` (Sync now, Fix connection, Disconnect keeping history,
  Disconnect and delete its data). Under a row: `Also from Copilot: <account> ••1234` with
  `Use this connection from today` when the same real account comes from both. Header:
  `Add account` → the Add account sheet (Accounts spec).
- **Data** — `Sync now` Button(primary), last sync, Copilot source and mode (cache / live /
  write-through, or off), queued writes count, bank connection count, `Import Copilot CSV` file input.
- **Features** — Budgeting (Toggle), Tags ›.
- **Appearance** — Theme: Automatic / Light / Dark (segmented).
- **Assistant** — API key status chip, model, `Clear conversations`.
- **Notifications** — Bank fee alert · Big expense alert · Budgets updates · Credit
  utilization alert · Income update · Low balance alert · Recurring paid alert · Spending
  update · Uncategorized transfer alert (each a Toggle; delivered via the assistant's
  weekly summary / MCP, not push).
- **Rollovers** — Enable rollovers (Toggle).
- **Connect Claude (MCP)** — copyable snippets for Claude Code, Claude Desktop, claude.ai.
- **Account** — Export all data (zip of SQLite + CSV), Reset local data.

**Data.** `/api/status`, `POST /api/sync`, `POST /api/import/csv`, `GET /api/connections`
(`get_connections`), `POST /api/connections/:id/sync`, `POST /api/connections/:id/repaired`,
`DELETE /api/connections/:id?delete_data=1`, `POST /api/accounts/:id/switch`, new `/api/settings`
(JSON blob in `meta`). Built in `web/connections.js`.
