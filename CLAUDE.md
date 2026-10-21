# Keel — notes for Claude Code sessions

Self-hosted personal finance app on top of Copilot Money data. Node 20 + TypeScript (Express, better-sqlite3), buildless PWA in `web/`. See README.md for setup and architecture.

## Design system (source of truth lives outside this repo)

The visual design is the **Keel** Design System artifact in Claude:
https://claude.ai/code/artifact/9d7113db-90b9-4825-ad3b-2478a3ab7239

- `design/tokens.json` is a verbatim copy of the artifact's `project/tokens.json`; `design/README.md` mirrors its brand book; `design/components.css` mirrors its `components/bundle.css` (the `.k-*` classes every component preview uses — build screens on these classes, extend them, never fork them).
- `web/tokens.css` is **generated** from `design/tokens.json` by `npm run tokens`. Never edit it by hand.
- `web/styles.css` consumes only `var(--token)` names from tokens.css. Do not introduce raw colours, font sizes or radii there — add a token first.

### Workflow for a design change
1. Change the artifact (tokens, README, cover) in a Claude chat, or change `design/tokens.json` here.
2. Copy the artifact's `project/tokens.json` → `design/tokens.json` (and README → `design/README.md`) so both match.
3. `npm run tokens`, check the app, commit `design/` and `web/tokens.css` together.
4. If a new component convention is introduced, document it in the artifact README (Components section) and mirror it here.

## What to build, in what order

- `docs/copilot-feature-map.md` — the behavioural audit of the source app: every screen, region, control, state and interaction. The target for functional parity.
- `docs/screens/README.md` — build order and global rules; one spec per screen in `docs/screens/*.md` (regions → components → data → states → interactions → acceptance).
- `docs/visuals/*.svg` — wireframes per screen, drawn from the tokens by `npm run wireframes`. Regenerate after a token change; never hand-edit.
- Component anatomy and rules: the design-system artifact's Components pane (one README + live preview each); the same classes live in `design/components.css`.
- The current `web/` app is v1 (single pane, dark-first). The target is the three-pane shell in `docs/screens/shell.md`; migrate screen by screen, keeping `src/tools.ts` and `src/queries.ts` as the data layer and adding the routes each spec lists under **Data**.

## Conventions
- Amounts: positive = money out, negative = money in (Copilot convention) — every query in `src/queries.ts` assumes it. Plaid already matches; SimpleFIN is negated in its mapper. Card and loan balances are stored as the positive amount owed.
- Data sources: Copilot (`src/sync/copilot.ts`) and direct bank connections (`src/sync/plaid.ts`, `src/sync/simplefin.ts`) all run through `syncAll()` in `src/sync/index.ts`. Ids are namespaced (`plaid:`, `sfin:`). A Keel-side edit is recorded in the row's `local_edits` (`markEdited`) and sync upserts use `preserveEdited`, so edits survive syncs.
- Tools that take or return bank credentials, or add/remove a connection, are `internal: true`: REST only, never the assistant or MCP.
- One tool registry (`src/tools.ts`) feeds the assistant, `/mcp`, and REST; add capabilities there, not in three places.
- `npm run typecheck` and `npm test` must pass; `npm run demo` seeds sample data for UI work; screenshots via Playwright (see README).
- Never commit `.env` or `data/`.
