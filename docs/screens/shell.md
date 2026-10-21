# Shell

**Purpose.** The frame every screen lives in: sidebar, panes, title bars, phone tab bar.

**Layout.** `grid-template-columns: var(--sidebar-w) 1fr` on desktop; main pane may be
split `1fr 1fr` with a detail pane. Sidebar `bg-100` with right `hairline`; panes scroll
independently; title bars are sticky.

**Regions.**
1. Sidebar top: window controls row (back/forward/refresh IconButtons, right-aligned).
2. Search — `Button`/`Input` search variant, `⌘K` → command palette over transactions,
   accounts, categories, recurrings (reuse `/api/transactions?q`, `/api/accounts`,
   `/api/categories`, `/api/recurring`).
3. Primary nav — 8 × `NavItem` (Lucide icons per README) + `Assistant` as a 9th item in Keel.
4. `MY ACCOUNTS` eyebrow → groups by `accounts.type` (Credit cards, Depository,
   Investments, Loans, Other), each a collapsible header + `AccountNavRow`s.
   Balance abbreviates: `$5,278`, `$47.9k` over 10k. Hidden/closed rows faint, at the end.
5. Footer: `Start here` (onboarding checklist; `warning` dot while incomplete),
   `Get help`, `Settings` (opens the Settings sheet).
6. Title bars — `TitleBar` per pane.

**Data.** `/api/accounts` (sidebar), `/api/status` (sync pill folded into the footer:
`Synced 5 min ago`, amber when > 6h).

**States.** Collapsed groups persist in localStorage. Offline: footer shows `Offline`.

**Phone.** Tab bar: Dashboard · Transactions · Categories · Accounts · Assistant;
everything else via a `More` sheet. Detail panes push as full-screen sheets.

**Acceptance.** Sidebar matches the wireframes pixel-wise within the 4px grid; nav active
state uses `brand-tint`/`brand`; resizing between 1400 → 900 → 390 never horizontal-scrolls.
