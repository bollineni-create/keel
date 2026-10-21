# Settings (sheet)

Source audit: feature map §9. Opens from the sidebar footer as a right sheet
(`shadow-pop`), 420px, `×` to close.

**Sections (Toggle rows, 36px).**
- **Data** — `Sync from Copilot` Button(primary), last sync, mode (cache / live /
  write-through), queued writes count, `Import Copilot CSV` file input.
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

**Data.** `/api/status`, `POST /api/sync`, `POST /api/import/csv`, new `/api/settings` (JSON
blob in `meta`).
