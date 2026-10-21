import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpServer } from './mcp.js';
import { getDb } from './db.js';

getDb();
const server = buildMcpServer();
await server.connect(new StdioServerTransport());
