# Assistant

Wireframe: `../visuals/assistant.svg`. Source audit: feature map §9 (Copilot's assistant) —
in Daybook the assistant is the **front door**: the home route (`#/`), `⌘1`, the first phone
tab, and a dock beside every other screen (`⌘J`). It talks to the same tool registry
(`src/tools.ts`) that Claude reaches over MCP, so what it can do here is exactly what
Claude Desktop / Claude Code can do against `/mcp`.

**Layout.** `content--chat`: a 240px conversation rail (`pane--surface`) + the chat pane.
The dock (`.app.has-dock`) is a 384px third column of the app grid with the compact
`chat--compact` variant; it never shows on the Assistant route itself (same conversation,
full size) or under 900px (the Assistant tab is one tap away).

| # | Region | Component(s) | Data |
| --- | --- | --- | --- |
| R1 | Conversation rail | `TitleBar` `Conversations`; `NavItem` per conversation (title = first user line, `ago` on the right, `…` menu → Open / Delete); footer `model · N tools` in `ink-faint` | `GET /api/chat` (list), `DELETE /api/chat/:id`, `/api/status` |
| M1 | Title bar | `Assistant` + `no API key` chip(amber) when unconfigured; `Conversations` IconButton (phone only, opens a sheet); `+ New chat` | `/api/status` |
| M2 | Transcript | user bubbles (`brand-tint`, right), assistant replies as plain body copy rendered from markdown-lite (bold, code, lists, tables with `eyebrow` headers, links), **tool cards** (`<details>`: status dot amber→`positive`/`negative`, tool name, input summary, `Open` link to the screen that holds the data, expandable input JSON), typing dots while waiting | `GET /api/chat/:id`, `POST /api/assistant` (SSE) |
| M3 | Welcome | EmptyState disc(`brand-tint`) + `What do you want to know?` when the conversation is empty | — |
| M4 | Starters | up to 6 pill Buttons, the first ones computed from the data (`Review my N unreviewed transactions`, `Why am I over on {category}?`), then evergreen questions | `/api/summary`, `/api/budgets` |
| M5 | Composer | auto-growing textarea in a `radius-lg` card, `↑` primary send → `■` Stop while streaming; hint line `Enter to send · Shift+Enter for a new line` | `POST /api/assistant` |

**Data.** `POST /api/assistant {conversation_id, message, context:{screen, route}}` streams
`text` · `tool {id, name, input}` · `tool_result {id, ok, error?}` · `error` · `done`.
`context` is what the user is looking at while asking, folded into the system prompt so
"this" and "here" resolve. Closing the stream (Stop, closed tab) aborts the Anthropic
call; any partial reply is saved so the transcript stays coherent.
The reply is asked to link into the app with Daybook routes (`[Dining this month](#/transactions?categories=…)`)
using ids returned by tools; markdown-lite renders only `#/…` and `https://` hrefs.

**States.** Not configured → `no API key` chip, sending shows the error with an
`Open Settings` button; MCP keeps working. Loading a conversation → two skeleton bubbles.
No conversations → rail hint `Your conversations will appear here.` Offline → the send
fails with the fetch error in a `chat-error` paragraph.

**Interactions.** `Enter` sends, `Shift+Enter` newline, `/` focuses the composer, `⌘J`
toggles the dock (on the Assistant route it focuses the composer; on phone it opens the
tab). Rail click swaps the transcript in place (`#/?c=<id>`), `+ New chat` starts a fresh
id (`keel-conv` in localStorage is the current one, shared by the screen and the dock).
When a reply finishes, the shell refreshes the sidebar and re-renders stateless screens
under the dock, since a tool call may have categorized, reviewed or budgeted. Settings →
Assistant → `Clear conversations` (`DELETE /api/chat`).

**Acceptance.** Home loads with ≤ 4 API calls (`/status`, `/chat`, `/chat/:id`, starters);
a tool card's `Open` lands on the screen filtered to the call's inputs; stopping mid-reply
leaves the partial text in the transcript after reload; the dock never horizontal-scrolls
the main pane at 1100px; at 390px the rail is a sheet and the tab bar shows Assistant first.
