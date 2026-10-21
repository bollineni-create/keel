/**
 * Daybook as an MCP server. Two transports:
 *  - Streamable HTTP at POST /mcp (mounted by server.ts) — for claude.ai custom connectors (via Tailscale/ngrok), Claude Desktop, Claude Code `--transport http`
 *  - stdio (`npm run mcp`) — for Claude Desktop / Claude Code launching it locally
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { publicTools, runTool } from './tools.js';

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'daybook', version: '0.1.0' });
  for (const t of publicTools) {
    const shape = t.schema instanceof z.ZodObject ? t.schema.shape : {};
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: shape, annotations: { readOnlyHint: t.readOnly, destructiveHint: !t.readOnly, openWorldHint: false } },
      async (args: unknown) => {
        try {
          const out = await runTool(t.name, args);
          return { content: [{ type: 'text' as const, text: JSON.stringify(out) }] };
        } catch (e) {
          return { content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }], isError: true };
        }
      },
    );
  }
  return server;
}
