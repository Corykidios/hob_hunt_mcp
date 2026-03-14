import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { setGlobalDebug, closeBrowser } from "./browser.js";
import { registerHobSearch } from "./tools/search.js";
import { registerHobSite, registerHobSites, registerBrowserInstall } from "./tools/fetch.js";

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const debugMode = args.includes("--debug");

if (debugMode) {
  setGlobalDebug(true);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "hob_hunt_mcp",
  version: "1.0.0",
});

registerHobSearch(server);
registerHobSite(server);
registerHobSites(server);
registerBrowserInstall(server);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(): Promise<void> {
  await closeBrowser();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ---------------------------------------------------------------------------
// Start — stdio transport (compatible with Claude Desktop and Letta)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("hob_hunt_mcp running (stdio)\n");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal: ${message}\n`);
  process.exit(1);
});
