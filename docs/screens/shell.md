# Shell

**Purpose.** The frame every screen lives in: sidebar, panes, title bars, phone tab bar.

**Layout.** `grid-template-columns: var(--sidebar-w) 1fr` on desktop (`+ 384px` when the
assistant dock is open); main pane may be split `1fr 1fr` with a detail pane. Sidebar `bg-100` with right `hairline`; panes scroll
independently; title bars are sticky.

**Regions.**
1. Sidebar top: window controls row (back/forward/refresh IconButtons, right-aligned).
2. Search — `Button`/`Input` search variant, `⌘K` → command palette over transactions,
   accounts, categories, recurrings (reuse `/api/transactions?q`, `/api/accounts`,
   `/api/categories`, `/api/recurring`).
3. Primary nav — `Assistant` first (the home route, `⌘1`), then the 8 Copilot screens as
   `NavItem`s (Lucide icons per README). The window-controls row also carries the `Ask Daybook`
   dock toggle (`⌘J`): the assistant rides as a third column beside any screen (see
   `assistant.md`).
4. `MY ACCOUNTS` eyebrow → groups by `accounts.type` (Credit cards, Depository,
   Investments, Loans, Other), each a collapsible header + `AccountNavRow`s.
   Balance abbreviates: `$5,278`, `$47.9k` over 10k. Hidden/closed rows faint, at the end.
5. Footer: `Start here` (onboarding checklist; `warning` dot while incomplete),
   `Get help`, `Settings` (opens the Settings sheet).
6. Title bars — `TitleBar` per pane.

**Data.** `/api/accounts` (sidebar), `/api/status` (sync pill folded into the footer:
`Synced 5 min ago`, amber when > 6h).

**States.** Collapsed groups persist in localStorage. Offline: footer shows `Offline`.

**Phone.** Tab bar: Assistant · Dashboard · Transactions · Categories · Accounts;
everything else via a `More` sheet. Detail panes push as full-screen sheets.

**Acceptance.** Sidebar matches the wireframes pixel-wise within the 4px grid; nav active
state uses `brand-tint`/`brand`; resizing between 1400 → 900 → 390 never horizontal-scrolls.
