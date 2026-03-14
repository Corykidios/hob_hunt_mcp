import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { newContext } from "../browser.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

interface QueryResult {
  query: string;
  results: SearchResult[];
}

interface SearchOutput {
  searches: QueryResult[];
}

// ---------------------------------------------------------------------------
// Core search logic
// ---------------------------------------------------------------------------

async function searchOne(
  query: string,
  limit: number,
  timeout: number,
  locale: string,
  noSaveState: boolean,
  debug: boolean
): Promise<QueryResult> {
  const context = await newContext({ debug });

  await context.addInitScript(`
    Object.defineProperty(navigator, 'language', { get: () => '${locale}' });
    Object.defineProperty(navigator, 'languages', { get: () => ['${locale}'] });
  `);

  const page = await context.newPage();

  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(limit, 100)}&hl=${locale.split("-")[0]}`;

    await page.goto(url, { waitUntil: "domcontentloaded", timeout });

    const hasCaptcha = await page.$("form#captcha-form, #recaptcha").then(Boolean);
    if (hasCaptcha) {
      if (!debug) {
        await context.close();
        const debugContext = await newContext({ debug: true });
        const debugPage = await debugContext.newPage();
        await debugPage.goto(url, { waitUntil: "domcontentloaded", timeout });
        await debugPage.waitForNavigation({ timeout: 120_000 }).catch(() => undefined);
        const results = await extractResults(debugPage, limit);
        await debugContext.close();
        return { query, results };
      }
      await page.waitForNavigation({ timeout: 120_000 }).catch(() => undefined);
    }

    const results = await extractResults(page, limit);
    return { query, results };
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function extractResults(
  page: import("playwright").Page,
  limit: number
): Promise<SearchResult[]> {
  return page.evaluate((lim: number) => {
    const items: Array<{ title: string; link: string; snippet: string }> = [];
    const containers = document.querySelectorAll("div.g, div[data-sokoban-container]");

    for (const container of Array.from(containers)) {
      if (items.length >= lim) break;

      const anchor = container.querySelector("a[href]") as HTMLAnchorElement | null;
      const titleEl = container.querySelector("h3");
      const snippetEl = container.querySelector(
        "div.VwiC3b, span.aCOpRe, div[data-sncf], div.s"
      );

      const link = anchor?.href ?? "";
      const title = (titleEl as HTMLElement | null)?.innerText?.trim() ?? "";
      const snippet = (snippetEl as HTMLElement | null)?.innerText?.trim() ?? "";

      if (link && title && !link.startsWith("https://www.google.com")) {
        items.push({ title, link, snippet });
      }
    }

    return items;
  }, limit);
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerHobSearch(server: McpServer): void {
  server.registerTool(
    "hob_search",
    {
      title: "Hob Search",
      description: `Perform one or more Google searches in parallel and return structured results.

Accepts an array of search queries and executes them concurrently.

Args:
  - queries (string[]): One or more search terms to look up. Required.
  - limit (number): Maximum results per query. Default 10, max 100.
  - timeout (number): Page-load timeout in milliseconds. Default 60000.
  - noSaveState (boolean): Do not persist browser state between calls. Default false.
  - locale (string): BCP-47 locale, e.g. "en-US". Default "en-US".
  - debug (boolean): Show browser window. Default false.

Returns:
  JSON: { searches: [{ query, results: [{ title, link, snippet }] }] }`,
      inputSchema: z.object({
        queries: z.array(z.string().min(1)).min(1)
          .describe("One or more Google search queries to execute in parallel"),
        limit: z.number().int().min(1).max(100).default(10)
          .describe("Maximum results per query (default 10)"),
        timeout: z.number().int().min(1000).default(60_000)
          .describe("Page-load timeout in ms (default 60000)"),
        noSaveState: z.boolean().default(false)
          .describe("If true, do not persist browser state between calls"),
        locale: z.string().default("en-US")
          .describe('BCP-47 locale for results, e.g. "en-US" or "zh-CN"'),
        debug: z.boolean().default(false)
          .describe("Show browser window — handy when a CAPTCHA appears"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ queries, limit, timeout, noSaveState, locale, debug }) => {
      try {
        const settled = await Promise.allSettled(
          queries.map((q) => searchOne(q, limit, timeout, locale, noSaveState, debug))
        );
        const searches: QueryResult[] = settled.map((r, i) => {
          if (r.status === "fulfilled") return r.value;
          return { query: queries[i] ?? "", results: [] };
        });
        const output: SearchOutput = { searches };
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error during search: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
