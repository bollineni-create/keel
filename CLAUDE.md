# Keel — notes for Claude Code sessions

Self-hosted personal finance app on top of Copilot Money data. Node 20 + TypeScript (Express, better-sqlite3), buildless PWA in `web/`. See README.md for setup and architecture.

## Design system (source of truth lives outside this repo)

The visual design is the **Keel** Design System artifact in Claude:
https://claude.ai/code/artifact/9d7113db-90b9-4825-ad3b-2478a3ab7239

- `design/tokens.json` is a verbatim copy of the artifact's `project/tokens.json`; `design/README.md` mirrors its brand book.
- `web/tokens.css` is **generated** from `design/tokens.json` by `npm run tokens`. Never edit it by hand.
- `web/styles.css` consumes only `var(--token)` names from tokens.css. Do not introduce raw colours, font sizes or radii there — add a token first.

### Workflow for a design change
1. Change the artifact (tokens, README, cover) in a Claude chat, or change `design/tokens.json` here.
2. Copy the artifact's `project/tokens.json` → `design/tokens.json` (and README → `design/README.md`) so both match.
3. `npm run tokens`, check the app, commit `design/` and `web/tokens.css` together.
4. If a new component convention is introduced, document it in the artifact README (Components section) and mirror it here.

## Conventions
- Amounts: positive = money out, negative = money in (Copilot convention) — every query in `src/queries.ts` assumes it.
- One tool registry (`src/tools.ts`) feeds the assistant, `/mcp`, and REST; add capabilities there, not in three places.
- `npm run typecheck` must pass; `npm run demo` seeds sample data for UI work; screenshots via Playwright (see README).
- Never commit `.env` or `data/`.
