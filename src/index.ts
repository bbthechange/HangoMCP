#!/usr/bin/env node
/**
 * Hango MCP Server entry point.
 *
 * Usage:
 *   hango-mcp                 → run the MCP server (reads credential from keychain)
 *   hango-mcp login           → interactive login flow
 *   hango-mcp logout          → clear credential, best-effort backend revoke
 *   hango-mcp status          → show login state
 *   hango-mcp --help          → usage
 *
 * Optional flags (server mode):
 *   --timezone <tz>           → override timezone (default: OS timezone)
 *   --base-url <url>          → override API base URL (default: production)
 */

import { Command } from 'commander';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { runLogin, runLogout, runStatus } from './cli.js';
import { CredentialStorage } from './credentials.js';
import { HangoApiError, HttpClient } from './http-client.js';
import { ToolHandlers } from './tool-handlers.js';
import { TOOL_SCHEMAS } from './tool-schemas.js';
import type { ApiProfileResponse, SessionContext } from './types.js';

const PRODUCTION_API = 'https://am6c8sp6kh.execute-api.us-west-2.amazonaws.com/prod';
const NOT_LOGGED_IN_MESSAGE =
  'Not logged in. Run `npx hango-mcp login` in your terminal to connect your Hango account.';

function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'America/Denver';
  }
}

interface ServerOptions {
  timezone?: string;
  baseUrl?: string;
}

async function runServer(opts: ServerOptions): Promise<void> {
  const timezone = opts.timezone || defaultTimezone();
  const baseUrl = opts.baseUrl || PRODUCTION_API;

  console.error('Hango MCP Server starting...');
  console.error(`Timezone: ${timezone}`);
  console.error(`API: ${baseUrl}`);

  const store = new CredentialStorage();
  const cred = await store.load();
  if (!cred) {
    console.error(NOT_LOGGED_IN_MESSAGE);
    process.exit(1);
  }

  const ctx: SessionContext = {
    jwt: cred.accessToken,
    refreshToken: cred.refreshToken,
    userId: '',
    displayName: cred.displayName,
    timezone,
    baseUrl,
  };

  // Build a temp HttpClient that knows how to refresh, so /profile validation
  // can transparently refresh on 401.
  const validator = new HttpClient(ctx, { store });
  let userId: string;
  let displayName: string;
  try {
    const profile = await validator.request<ApiProfileResponse>('/profile');
    if (!profile.id) throw new Error('Invalid profile response — no id');
    userId = profile.id;
    displayName = profile.displayName ?? profile.username;
    console.error(`Authenticated as: ${displayName} (${userId})`);
  } catch (err) {
    if (err instanceof HangoApiError && err.code === 'SESSION_EXPIRED') {
      console.error(err.message);
    } else {
      console.error(`Authentication failed: ${err instanceof Error ? err.message : err}`);
    }
    process.exit(1);
  }

  const finalCtx: SessionContext = { ...ctx, userId, displayName };
  const handlers = new ToolHandlers(finalCtx, { store });

  const server = new Server(
    { name: 'hango', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  const toolList = Object.values(TOOL_SCHEMAS).map(schema => ({
    name: schema.name,
    description: schema.description,
    inputSchema: schema.inputSchema,
  }));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handlers.dispatch(name, args ?? {});
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      // If session expired, surface the exact UX-doc message so the AI relays it cleanly.
      if (err instanceof HangoApiError && err.code === 'SESSION_EXPIRED') {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: err.message }],
        };
      }
      throw err;
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Hango MCP Server connected and ready.');
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('hango-mcp')
    .description('Hango MCP server and authentication CLI.')
    .option('--timezone <tz>', 'IANA timezone (e.g., America/Denver)')
    .option('--base-url <url>', 'API base URL', PRODUCTION_API);

  program
    .command('login')
    .description('Log in to your Hango account and store credentials securely.')
    .option('--base-url <url>', 'API base URL', PRODUCTION_API)
    .action(async (cmdOpts: { baseUrl: string }) => {
      const code = await runLogin({ baseUrl: cmdOpts.baseUrl });
      process.exit(code);
    });

  program
    .command('logout')
    .description('Clear your stored Hango credential.')
    .option('--base-url <url>', 'API base URL', PRODUCTION_API)
    .action(async (cmdOpts: { baseUrl: string }) => {
      const code = await runLogout({ baseUrl: cmdOpts.baseUrl });
      process.exit(code);
    });

  program
    .command('status')
    .description('Show whether hango-mcp is currently logged in.')
    .action(async () => {
      const code = await runStatus({ baseUrl: PRODUCTION_API });
      process.exit(code);
    });

  // Default action (no subcommand): run the MCP server.
  program.action(async (opts: ServerOptions) => {
    await runServer(opts);
  });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
