import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBrowser } from "../browser.js";
import { fetchOne } from "./site.js";
// @ts-ignore
import * as fs from "fs";
// @ts-ignore
import * as path from "path";

interface SearchResult { title: string; link: string; snippet: string; }
interface QueryResult  { query: string; results: SearchResult[]; }
interface SearchOutput { searches: QueryResult[]; }
interface FingerprintConfig {
  deviceName: string;
  locale: string;
  timezoneId: string;
  colorScheme: "dark" | "light";
}
interface SavedState { fingerprint?: FingerprintConfig; googleDomain?: string; }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOOGLE_DOMAINS = [
  "https://www.google.com",
  "https://www.google.co.uk",
  "https://www.google.ca",
  "https://www.google.com.au",
];

const RESULT_SELECTORS = [
  { container: "#search .g",                     title: "h3", snippet: ".VwiC3b" },
  { container: "#rso .g",                        title: "h3", snippet: ".VwiC3b" },
  { container: ".g",                             title: "h3", snippet: ".VwiC3b" },
  { container: "[data-sokoban-container] > div", title: "h3", snippet: "[data-sncf='1']" },
  { container: "div[role='main'] .g",            title: "h3", snippet: "[data-sncf='1']" },
];

const CAPTCHA_PATTERNS = [
  "google.com/sorry/index", "google.com/sorry", "recaptcha", "captcha", "unusual traffic",
];

const SEARCH_INPUT_SELECTORS = [
  "textarea[name='q']", "input[name='q']", "textarea[title='Search']",
  "input[title='Search']", "textarea[aria-label='Search']", "input[aria-label='Search']",
  "textarea",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function isBlocked(url: string): boolean {
  return CAPTCHA_PATTERNS.some((p) => url.includes(p));
}
function hostFingerprint(locale: string): FingerprintConfig {
  const offset = new Date().getTimezoneOffset();
  let timezoneId = "America/New_York";
  if      (offset <= -480 && offset > -600) timezoneId = "Asia/Shanghai";
  else if (offset <= -540)                  timezoneId = "Asia/Tokyo";
  else if (offset <= -420 && offset > -480) timezoneId = "Asia/Bangkok";
  else if (offset <= 0    && offset > -60)  timezoneId = "Europe/London";
  else if (offset > 0     && offset <= 60)  timezoneId = "Europe/Berlin";
  const hour = new Date().getHours();
  const colorScheme: "dark" | "light" = (hour >= 19 || hour < 7) ? "dark" : "light";
  return { deviceName: "Desktop Chrome", locale, timezoneId, colorScheme };
}
function loadState(stateFile: string): SavedState {
  if (!fs.existsSync(stateFile)) return {};
  try {
    const fpFile = stateFile.replace(".json", "-fingerprint.json");
    if (fs.existsSync(fpFile)) return JSON.parse(fs.readFileSync(fpFile, "utf8")) as SavedState;
  } catch { /* ignore */ }
  return {};
}
async function saveState(
  context: import("playwright").BrowserContext,
  stateFile: string,
  saved: SavedState
): Promise<void> {
  try {
    const dir = path.dirname(stateFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await context.storageState({ path: stateFile });
    fs.writeFileSync(
      stateFile.replace(".json", "-fingerprint.json"),
      JSON.stringify(saved, null, 2),
      "utf8"
    );
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Core search — one query
// FIX: replaced the flaky Promise.all([waitForNavigation, press]) pattern.
// We now press Enter first, then await waitForLoadState separately.
// This eliminates the race where navigation could start and complete before
// the waitForNavigation promise was even registered.
// ---------------------------------------------------------------------------

async function searchOne(
  query: string,
  limit: number,
  timeout: number,
  locale: string,
  noSaveState: boolean,
  debug: boolean,
  stateFile: string,
  savedState: SavedState
): Promise<QueryResult> {
  const browser = await getBrowser({ debug });
  const fp = savedState.fingerprint ?? hostFingerprint(locale);
  savedState.fingerprint = fp;
  const storageState = (!noSaveState && fs.existsSync(stateFile)) ? stateFile : undefined;

  const contextOptions: Record<string, unknown> = {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: fp.locale,
    timezoneId: fp.timezoneId,
    colorScheme: fp.colorScheme,
    viewport: { width: 1280, height: 800 },
    isMobile: false,
    hasTouch: false,
    javaScriptEnabled: true,
    permissions: ["geolocation", "notifications"],
    acceptDownloads: true,
  };
  if (storageState) contextOptions.storageState = storageState;

  // @ts-ignore
  const context = await (browser as any).newContext(contextOptions);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "plugins",   { get: () => [1, 2, 3, 4, 5] });
    // @ts-ignore
    window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
    if (typeof WebGLRenderingContext !== "undefined") {
      const gp = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (p: number) {
        if (p === 37445) return "Intel Inc.";
        if (p === 37446) return "Intel Iris OpenGL Engine";
        return gp.call(this, p);
      };
    }
  });

  const page = await context.newPage();
  // Keep stylesheets — Google needs them to render result containers
  await page.route("**/*", (route: any) => {
    const t = route.request().resourceType();
    if (["image", "font", "media"].includes(t)) route.abort().catch(() => undefined);
    else route.continue().catch(() => undefined);
  });

  try {
    if (!savedState.googleDomain) {
      savedState.googleDomain = GOOGLE_DOMAINS[Math.floor(Math.random() * GOOGLE_DOMAINS.length)];
    }
    const domain = savedState.googleDomain;

    await page.goto(domain, { waitUntil: "networkidle", timeout });

    if (isBlocked(page.url())) {
      if (debug) {
        process.stderr.write("[hunt_search] CAPTCHA on homepage — solve it in the browser window.\n");
        await page.waitForNavigation({
          timeout: 120_000,
          url: (u: URL) => !isBlocked(u.toString()),
        }).catch(() => undefined);
      } else {
        if (!noSaveState) await saveState(context, stateFile, savedState);
        await context.close().catch(() => undefined);
        return { query, results: [] };
      }
    }

    // Find the search input
    let searchInput: import("playwright").ElementHandle | null = null;
    for (const sel of SEARCH_INPUT_SELECTORS) {
      searchInput = await page.$(sel);
      if (searchInput) break;
    }
    if (!searchInput) throw new Error("Could not find Google search input");

    await searchInput.click();
    await page.keyboard.type(query, { delay: rand(10, 35) });
    await page.waitForTimeout(rand(100, 300));

    // FIX: press first, then wait — no race condition
    await page.keyboard.press("Enter");
    await page.waitForLoadState("networkidle", { timeout }).catch(() => undefined);

    if (isBlocked(page.url())) {
      if (debug) {
        process.stderr.write("[hunt_search] CAPTCHA on results — solve it in the browser window.\n");
        await page.waitForNavigation({
          timeout: 120_000,
          url: (u: URL) => !isBlocked(u.toString()),
        }).catch(() => undefined);
        await page.waitForLoadState("networkidle", { timeout }).catch(() => undefined);
      } else {
        if (!noSaveState) await saveState(context, stateFile, savedState);
        await context.close().catch(() => undefined);
        return { query, results: [] };
      }
    }

    // Wait for result containers
    let resultsFound = false;
    for (const sel of ["#search", "#rso", ".g", "[data-sokoban-container]", "div[role='main']"]) {
      try {
        await page.waitForSelector(sel, { timeout: Math.floor(timeout / 3) });
        resultsFound = true;
        break;
      } catch { /* try next */ }
    }
    if (!resultsFound) throw new Error("No search result containers found");

    await page.waitForTimeout(rand(200, 500));
    const results = await extractResults(page, limit);
    if (!noSaveState) await saveState(context, stateFile, savedState);
    return { query, results };
  } finally {
    await context.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Result extraction — multiple selector strategies with fallbacks
// ---------------------------------------------------------------------------

async function extractResults(
  page: import("playwright").Page,
  limit: number
): Promise<SearchResult[]> {
  for (const sel of RESULT_SELECTORS) {
    try {
      const results = await page.$$eval(
        sel.container,
        (els: Element[], params: { limit: number; title: string; snippet: string }) =>
          els.slice(0, params.limit).map((el: Element) => ({
            title:   ((el.querySelector(params.title)   as HTMLElement | null)?.innerText?.trim() ?? ""),
            link:    ((el.querySelector("a")            as HTMLAnchorElement | null)?.href ?? ""),
            snippet: ((el.querySelector(params.snippet) as HTMLElement | null)?.innerText?.trim() ?? ""),
          })).filter((r) => r.title && r.link),
        { limit, title: sel.title, snippet: sel.snippet }
      );
      if (results.length > 0) return results as SearchResult[];
    } catch { /* try next */ }
  }

  // h3-anchor fallback
  try {
    const results = await page.evaluate((lim: number) => {
      const items: Array<{ title: string; link: string; snippet: string }> = [];
      for (const h of Array.from(document.querySelectorAll("h3"))) {
        if (items.length >= lim) break;
        const anchor = (h.closest("a") ?? h.parentElement?.querySelector("a")) as HTMLAnchorElement | null;
        const link  = anchor?.href ?? "";
        const title = (h as HTMLElement).innerText?.trim() ?? "";
        if (title && link && link.startsWith("http") && !link.includes("google.com/search"))
          items.push({ title, link, snippet: "" });
      }
      return items;
    }, limit);
    if (results.length > 0) return results;
  } catch { /* fall through */ }

  // Bare-anchor last resort
  return page.$$eval(
    "a[href^='http']",
    (els: Element[], lim: number) => els
      .filter((el: Element) => {
        const h = (el as HTMLAnchorElement).href;
        return h && !h.includes("google.com/") && !h.includes("accounts.google");
      })
      .slice(0, lim)
      .map((el: Element) => ({
        title:   (el as HTMLElement).innerText?.trim() ?? "",
        link:    (el as HTMLAnchorElement).href,
        snippet: "",
      }))
      .filter((r) => r.title && r.link),
    limit
  ) as Promise<SearchResult[]>;
}

// ---------------------------------------------------------------------------
// Register tool
// ---------------------------------------------------------------------------

export function registerHuntSearch(server: McpServer): void {
  server.registerTool(
    "hunt_search",
    {
      title: "Hunt Search",
      description: `Perform one or more Google searches in parallel and return structured results.

Uses a stealth Playwright browser with human-like navigation and persistent browser state
to avoid detection. On first CAPTCHA: run with debug=true, solve it once in the browser
window, and the saved session handles all future headless calls.

fetchTopN: optionally auto-fetch the top N result pages per query and append their full
content to the response — search and read in one shot.

Returns: JSON { searches: [{ query, results: [{ title, link, snippet }] }] }
With fetchTopN > 0: also includes fetched page content sections below the JSON.`,
      inputSchema: z.object({
        queries:     z.array(z.string().min(1)).min(1)
          .describe("Search queries to run in parallel"),
        limit:       z.number().int().min(1).max(100).default(10)
          .describe("Max results per query (default 10)"),
        timeout:     z.number().int().min(1000).default(60_000)
          .describe("Page-load timeout in ms (default 60000)"),
        noSaveState: z.boolean().default(false)
          .describe("Skip saving/loading persistent browser state"),
        locale:      z.string().default("en-US")
          .describe("BCP-47 locale for results"),
        debug:       z.boolean().default(false)
          .describe("Show browser window (use to solve CAPTCHA manually)"),
        stateDir:    z.string().default("C:/c/apps/servers/hob_hunt_mcp/browser-state")
          .describe("Directory for persistent browser state files"),
        fetchTopN:   z.number().int().min(0).max(5).default(0)
          .describe("Auto-fetch the top N result pages per query and append their content (0 = off, max 5)"),
      }),
      annotations: {
        readOnlyHint: true, destructiveHint: false,
        idempotentHint: false, openWorldHint: true,
      },
    },
    async ({ queries, limit, timeout, noSaveState, locale, debug, stateDir, fetchTopN }) => {
      try {
        // Run all searches in parallel
        const settled = await Promise.allSettled(
          queries.map((q, i) => {
            const stateFile = path.join(stateDir, `browser-state-${i}.json`);
            return searchOne(q, limit, timeout, locale, noSaveState, debug, stateFile, loadState(stateFile));
          })
        );
        const searches: QueryResult[] = settled.map((r, i) =>
          r.status === "fulfilled" ? r.value : { query: queries[i] ?? "", results: [] }
        );

        const output: string[] = [
          JSON.stringify({ searches } as SearchOutput, null, 2),
        ];

        // fetchTopN: follow up by fetching the top N result pages per query
        if (fetchTopN > 0) {
          const fetchOpts = {
            timeout: 30_000,
            waitUntil: "load" as const,
            extractContent: true,
            maxLength: 8000,
            returnHtml: false,
            waitForNavigation: false,
            navigationTimeout: 10_000,
            disableMedia: true,
            debug,
            selector: "",
            waitForSelector: "",
            scrollToBottom: false,
            extractLinks: false,
            sandbox: true, // always sandbox auto-fetched pages
          };

          for (const qr of searches) {
            const topLinks = qr.results
              .slice(0, fetchTopN)
              .map((r) => r.link)
              .filter(Boolean);

            if (topLinks.length === 0) continue;

            output.push(`\n\n## Fetched Pages — Query: "${qr.query}"`);

            const pageResults = await Promise.allSettled(
              topLinks.map((url) => fetchOne(url, fetchOpts, true))
            );
            for (let i = 0; i < pageResults.length; i++) {
              const r = pageResults[i];
              const url = topLinks[i] ?? "";
              if (r.status === "fulfilled") {
                output.push(`\n### ${r.value.title}\nURL: ${r.value.url}\n\n${r.value.content}`);
              } else {
                const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
                output.push(`\n### Error fetching ${url}\n${msg}`);
              }
            }
          }
        }

        return { content: [{ type: "text", text: output.join("\n") }] };

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `hunt_search error: ${message}` }], isError: true };
      }
    }
  );
}