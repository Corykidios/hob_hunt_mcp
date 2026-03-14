import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { newContext } from "../browser.js";

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
// Core search — Google via stealth Playwright (no CAPTCHA with stealth plugin)
// ---------------------------------------------------------------------------

async function searchOne(
  query: string,
  limit: number,
  timeout: number,
  locale: string,
  debug: boolean
): Promise<QueryResult> {
  const context = await newContext({ debug });
  const page = await context.newPage();

  await page.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (["image", "stylesheet", "font", "media"].includes(type)) {
      route.abort().catch(() => undefined);
    } else {
      route.continue().catch(() => undefined);
    }
  });

  try {
    const lang = locale.split("-")[0];
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(limit, 100)}&hl=${lang}&gl=${lang}`;

    await page.goto(url, { waitUntil: "domcontentloaded", timeout });

    // If CAPTCHA still appears (unlikely with stealth), pop into debug mode
    const hasCaptcha = await page.$("form#captcha-form, #recaptcha").then(Boolean);
    if (hasCaptcha) {
      await context.close().catch(() => undefined);
      const debugCtx = await newContext({ debug: true });
      const debugPage = await debugCtx.newPage();
      await debugPage.goto(url, { waitUntil: "domcontentloaded", timeout });
      await debugPage.waitForNavigation({ timeout: 120_000 }).catch(() => undefined);
      const results = await extractResults(debugPage, limit);
      await debugCtx.close().catch(() => undefined);
      return { query, results };
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

    // Try multiple selector strategies for resilience across Google layouts
    const selectors = [
      "div.g",
      "div[data-hveid] a[href^='http']:has(h3)",
      "div[jscontroller] h3",
    ];

    // Primary: div.g containers
    const containers = document.querySelectorAll("div.g, div[data-sokoban-container]");
    for (const container of Array.from(containers)) {
      if (items.length >= lim) break;
      const anchor = container.querySelector("a[href^='http']") as HTMLAnchorElement | null;
      const titleEl = container.querySelector("h3");
      const snippetEl = container.querySelector("div[style='-webkit-line-clamp:2'], div.VwiC3b, span.aCOpRe, div[data-sncf]");
      const link = anchor?.href ?? "";
      const title = (titleEl as HTMLElement | null)?.innerText?.trim() ?? "";
      const snippet = (snippetEl as HTMLElement | null)?.innerText?.trim() ?? "";
      if (link && title && !link.includes("google.com/search")) {
        items.push({ title, link, snippet });
      }
    }

    // Fallback: scan all h3s with parent anchors if primary yielded nothing
    if (items.length === 0) {
      const headings = document.querySelectorAll("h3");
      for (const h of Array.from(headings)) {
        if (items.length >= lim) break;
        const anchor = h.closest("a") ?? h.parentElement?.querySelector("a");
        const link = (anchor as HTMLAnchorElement | null)?.href ?? "";
        const title = (h as HTMLElement).innerText?.trim() ?? "";
        if (link && title && link.startsWith("http") && !link.includes("google.com/search")) {
          items.push({ title, link, snippet: "" });
        }
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

Uses a stealth Playwright browser to bypass bot detection. Accepts an array of
queries and executes them concurrently for efficiency.

Args:
  - queries (string[]): One or more search terms. Required.
  - limit (number): Max results per query. Default 10, max 100.
  - timeout (number): Page-load timeout in ms. Default 30000.
  - locale (string): BCP-47 locale, e.g. "en-US". Default "en-US".
  - debug (boolean): Show browser window. Default false.

Returns:
  JSON: { searches: [{ query, results: [{ title, link, snippet }] }] }`,
      inputSchema: z.object({
        queries: z.array(z.string().min(1)).min(1)
          .describe("One or more search queries to execute in parallel"),
        limit: z.number().int().min(1).max(100).default(10)
          .describe("Maximum results per query (default 10)"),
        timeout: z.number().int().min(1000).default(30_000)
          .describe("Page-load timeout in ms (default 30000)"),
        locale: z.string().default("en-US")
          .describe('BCP-47 locale for results, e.g. "en-US"'),
        debug: z.boolean().default(false)
          .describe("Show browser window"),
      }),
      annotations: {
        readOnlyHint: true, destructiveHint: false,
        idempotentHint: false, openWorldHint: true,
      },
    },
    async ({ queries, limit, timeout, locale, debug }) => {
      try {
        const settled = await Promise.allSettled(
          queries.map((q) => searchOne(q, limit, timeout, locale, debug))
        );
        const searches: QueryResult[] = settled.map((r, i) => {
          if (r.status === "fulfilled") return r.value;
          return { query: queries[i] ?? "", results: [] };
        });
        const output: SearchOutput = { searches };
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Search error: ${message}` }], isError: true };
      }
    }
  );
}
