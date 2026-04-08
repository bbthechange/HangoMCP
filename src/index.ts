#!/usr/bin/env node
/**
 * Hango MCP Server
 *
 * Model Context Protocol server for the Hango social planning app.
 * Accepts a JWT token for authentication and provides tools for
 * managing groups, hangouts, RSVPs, and more.
 *
 * Usage:
 *   node dist/index.js --jwt <token> [--timezone <tz>] [--base-url <url>]
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { HttpClient } from './http-client.js';
import { ToolHandlers } from './tool-handlers.js';
import { TOOL_SCHEMAS } from './tool-schemas.js';
import type { ApiProfileResponse, SessionContext } from './types.js';

const PRODUCTION_API = 'https://am6c8sp6kh.execute-api.us-west-2.amazonaws.com/prod';

// ─── CLI Argument Parsing ───────────────────────────────────────────────────

function parseArgs(): { jwt: string; timezone: string; baseUrl: string } {
  const args = process.argv.slice(2);
  let jwt = '';
  let timezone = '';
  let baseUrl = PRODUCTION_API;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--jwt':
        jwt = args[++i] ?? '';
        break;
      case '--timezone':
        timezone = args[++i] ?? '';
        break;
      case '--base-url':
        baseUrl = args[++i] ?? PRODUCTION_API;
        break;
    }
  }

  if (!jwt) {
    console.error('Error: --jwt <token> is required');
    process.exit(1);
  }

  // Timezone resolution: (1) CLI arg, (2) OS auto-detect, (3) fallback
  if (!timezone) {
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      timezone = 'America/Denver';
    }
  }

  return { jwt, timezone, baseUrl };
}

// ─── Profile Validation ─────────────────────────────────────────────────────

async function validateSession(
  jwt: string,
  baseUrl: string,
): Promise<{ userId: string; displayName: string }> {
  const tempCtx: SessionContext = {
    jwt,
    userId: '',
    displayName: '',
    timezone: '',
    baseUrl,
  };
  const http = new HttpClient(tempCtx);

  const profile = await http.request<ApiProfileResponse>('/profile');
  if (!profile.userId) {
    throw new Error('Invalid profile response — no userId');
  }

  return { userId: profile.userId, displayName: profile.displayName };
}

// ─── Server Setup ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { jwt, timezone, baseUrl } = parseArgs();

  // Validate JWT and get user info
  console.error(`Hango MCP Server starting...`);
  console.error(`Timezone: ${timezone}`);
  console.error(`API: ${baseUrl}`);

  let userId: string;
  let displayName: string;
  try {
    const profile = await validateSession(jwt, baseUrl);
    userId = profile.userId;
    displayName = profile.displayName;
    console.error(`Authenticated as: ${displayName} (${userId})`);
  } catch (err) {
    console.error(`Authentication failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const ctx: SessionContext = { jwt, userId, displayName, timezone, baseUrl };
  const handlers = new ToolHandlers(ctx);

  // Create MCP server using low-level Server class for raw JSON Schema support
  const server = new Server(
    { name: 'hango', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  // Register tool listing handler
  const toolList = Object.values(TOOL_SCHEMAS).map(schema => ({
    name: schema.name,
    description: schema.description,
    inputSchema: schema.inputSchema,
  }));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolList,
  }));

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await handlers.dispatch(name, args ?? {});
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  });

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Hango MCP Server connected and ready.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
