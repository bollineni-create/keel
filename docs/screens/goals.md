# Goals

Wireframe: `../visuals/goals.svg`. Source audit: feature map §3.

**Layout.** Main only. Title bar: `Goals` · `+ Add a goal`.

**Regions.**
1. Summary Card: `$0 saved in Oct` · ring (saved this month ÷ planned) · `$0 to go in Oct`
   · cog (which accounts count).
2. Goal list: `GoalCard` — emoji · name · `$saved of $target` · monthly plan · linked
   account · progress ring; or EmptyState `Your goals will appear here after you create them.`

**Add/Edit sheet.** Name, emoji, target, target date, monthly contribution, linked account
(savings), colour.

**Data.** `/api/goals` (new CRUD over the `goals` table; Copilot goals are cache-only and
read-only — Daybook-native goals are editable).

**Acceptance.** Saved this month = sum of transactions flagged to the goal (Transactions
detail → `Goal +`) plus linked-account balance growth, whichever the goal is configured for.
