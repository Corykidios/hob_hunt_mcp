import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBrowser } from "../browser.js";
// @ts-ignore
import * as fs from "fs";
// @ts-ignore
import * as path from "path";
// @ts-ignore
import * as os from "os";

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

interface FingerprintConfig {
  deviceName: string;
  locale: string;
  timezoneId: string;
  colorScheme: "dark" | "light";
}

interface SavedState {
  fingerprint?: FingerprintConfig;
  googleDomain?: string;
}

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
  { container: "#search .g",                    title: "h3", snippet: ".VwiC3b" },
  { container: "#rso .g",                       title: "h3", snippet: ".VwiC3b" },
  { container: ".g",                            title: "h3", snippet: ".VwiC3b" },
  { container: "[data-sokoban-container] > div",title: "h3", snippet: "[data-sncf='1']" },
  { container: "div[role='main'] .g",           title: "h3", snippet: "[data-sncf='1']" },
];

const CAPTCHA_PATTERNS = [
  "google.com/sorry/index",
  "google.com/sorry",
  "recaptcha",
  "captcha",
  "unusual traffic",
];

const SEARCH_INPUT_SELECTORS = [
  "textarea[name='q']",
  "input[name='q']",
  "textarea[title='Search']",
  "input[title='Search']",
  "textarea[aria-label='Search']",
  "input[aria-label='Search']",
  "textarea",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isBlocked(url: string): boolean {
  return CAPTCHA_PATTERNS.some(p => url.includes(p));
}

/** Derive a fingerprint from the host machine so context looks internally consistent. */
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

/** Load saved fingerprint/domain state from disk. */
function loadState(stateFile: string): SavedState {
  const fpFile = stateFile.replace(".json", "-fingerprint.json");
  if (!fs.existsSync(stateFile)) return {};
  try {
    if (fs.existsSync(fpFile)) return JSON.parse(fs.readFileSync(fpFile, "utf8")) as SavedState;
  } catch { /* ignore */ }
  return {};
}

/** Persist browser storage state + fingerprint to disk. */
async function saveState(
  context: import("playwright").BrowserContext,
  stateFile: string,
  saved: SavedState
): Promise<void> {
  try {
    const dir = path.dirname(stateFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await context.storageState({ path: stateFile });
    fs.writeFileSync(stateFile.replace(".json", "-fingerprint.json"), JSON.stringify(saved, null, 2), "utf8");
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Core search — single query
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

  // Build context options matching host fingerprint
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

  // Patch navigator properties for extra stealth
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "plugins",   { get: () => [1, 2, 3, 4, 5] });
    // @ts-ignore
    window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
    if (typeof WebGLRenderingContext !== "undefined") {
      const gp = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(p: number) {
        if (p === 37445) return "Intel Inc.";
        if (p === 37446) return "Intel Iris OpenGL Engine";
        return gp.call(this, p);
      };
    }
  });

  const page = await context.newPage();

  // Block media resources for speed
  await page.route("**/*", (route: any) => {
    const t = route.request().resourceType();
    if (["image", "stylesheet", "font", "media"].includes(t)) {
      route.abort().catch(() => undefined);
    } else {
      route.continue().catch(() => undefined);
    }
  });

  try {
    // Pick/persist a Google domain
    if (!savedState.googleDomain) {
      savedState.googleDomain = GOOGLE_DOMAINS[Math.floor(Math.random() * GOOGLE_DOMAINS.length)];
    }
    const domain = savedState.googleDomain;

    // --- Human-like navigation: visit homepage, type into search box ---
    await page.goto(domain, { waitUntil: "networkidle", timeout });

    if (isBlocked(page.url())) {
      // Pop into debug so the user can solve the CAPTCHA
      await context.close().catch(() => undefined);
      const debugCtx = await (browser as any).newContext({ ...contextOptions, storageState: undefined });
      const debugPage = await debugCtx.newPage();
      await debugPage.goto(domain, { waitUntil: "domcontentloaded", timeout });
      await debugPage.waitForNavigation({ timeout: 120_000 }).catch(() => undefined);
      const results = await extractResults(debugPage, limit);
      if (!noSaveState) await saveState(debugCtx, stateFile, savedState);
      await debugCtx.close().catch(() => undefined);
      return { query, results };
    }

    // Find the search box and type naturally
    let searchInput: import("playwright").ElementHandle | null = null;
    for (const sel of SEARCH_INPUT_SELECTORS) {
      searchInput = await page.$(sel);
      if (searchInput) break;
    }
    if (!searchInput) throw new Error("Could not find Google search input");

    await searchInput.click();
    await page.keyboard.type(query, { delay: rand(10, 35) });
    await page.waitForTimeout(rand(100, 300));
    await page.keyboard.press("Enter");

    // Wait for results to load
    await page.waitForLoadState("networkidle", { timeout }).catch(() => undefined);

    if (isBlocked(page.url())) {
      // If still blocked after typing, fall back to debug mode visible window
      await page.waitForNavigation({
        timeout: 120_000,
        url: (u: URL) => !isBlocked(u.toString()),
      }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout }).catch(() => undefined);
    }

    // Wait for a result container to appear
    let resultsFound = false;
    for (const sel of ["#search", "#rso", ".g", "[data-sokoban-container]", "div[role='main']"]) {
      try {
        await page.waitForSelector(sel, { timeout: timeout / 3 });
        resultsFound = true;
        break;
      } catch { /* try next */ }
    }
    if (!resultsFound) throw new Error("No search result containers found in page");

    await page.waitForTimeout(rand(200, 500));

    const results = await extractResults(page, limit);
    if (!noSaveState) await saveState(context, stateFile, savedState);
    return { query, results };

  } finally {
    await context.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Result extraction — tries multiple selector strategies then falls back
// ---------------------------------------------------------------------------

async function extractResults(
  page: import("playwright").Page,
  limit: number
): Promise<SearchResult[]> {
  // Strategy 1: known Google result container selectors
  for (const sel of RESULT_SELECTORS) {
    try {
      const results = await page.$$eval(
        sel.container,
        (els: Element[], params: { limit: number; title: string; snippet: string }) => {
          return els.slice(0, params.limit).map((el: Element) => {
            const titleEl  = el.querySelector(params.title);
            const linkEl   = el.querySelector("a") as HTMLAnchorElement | null;
            const snippetEl = el.querySelector(params.snippet);
            return {
              title:   (titleEl  as HTMLElement | null)?.innerText?.trim() ?? "",
              link:    linkEl?.href ?? "",
              snippet: (snippetEl as HTMLElement | null)?.innerText?.trim() ?? "",
            };
          }).filter((r: { title: string; link: string; snippet: string }) => r.title && r.link);
        },
        { limit, title: sel.title, snippet: sel.snippet }
      );
      if (results.length > 0) return results as SearchResult[];
    } catch { /* try next */ }
  }

  // Strategy 2: h3 headings with parent anchors
  try {
    const results = await page.evaluate((lim: number) => {
      const items: Array<{ title: string; link: string; snippet: string }> = [];
      for (const h of Array.from(document.querySelectorAll("h3"))) {
        if (items.length >= lim) break;
        const anchor = (h.closest("a") ?? h.parentElement?.querySelector("a")) as HTMLAnchorElement | null;
        const link  = anchor?.href ?? "";
        const title = (h as HTMLElement).innerText?.trim() ?? "";
        if (title && link && link.startsWith("http") && !link.includes("google.com/search")) {
          items.push({ title, link, snippet: "" });
        }
      }
      return items;
    }, limit);
    if (results.length > 0) return results;
  } catch { /* fall through */ }

  // Strategy 3: any external anchor on the page
  return page.$$eval(
    "a[href^='http']",
    (els: Element[], lim: number) => {
      return els
        .filter((el: Element) => {
          const href = (el as HTMLAnchorElement).href;
          return href && !href.includes("google.com/") && !href.includes("accounts.google");
        })
        .slice(0, lim)
        .map((el: Element) => ({
          title:   (el as HTMLElement).innerText?.trim() ?? "",
          link:    (el as HTMLAnchorElement).href,
          snippet: "",
        }))
        .filter((r: { title: string; link: string; snippet: string }) => r.title && r.link);
    },
    limit
  ) as Promise<SearchResult[]>;
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

Uses a stealth Playwright browser with human-like navigation (types into the search
box with realistic delays rather than hitting the search URL directly), persistent
browser state across calls (so Google sees a returning user), host-matched fingerprinting,
and multi-domain rotation. Falls back gracefully through multiple result selector
strategies. All queries in a batch share one browser instance.

Args:
  - queries (string[]): One or more search terms. Required.
  - limit (number): Max results per query. Default 10, max 100.
  - timeout (number): Page-load timeout in ms. Default 60000.
  - noSaveState (boolean): Skip saving/loading browser state. Default false.
  - locale (string): BCP-47 locale, e.g. "en-US". Default "en-US".
  - debug (boolean): Show browser window (handy for solving CAPTCHAs). Default false.
  - stateDir (string): Directory to store browser state files. Default "./browser-state".

Returns:
  JSON: { searches: [{ query, results: [{ title, link, snippet }] }] }`,
      inputSchema: z.object({
        queries: z.array(z.string().min(1)).min(1)
          .describe("One or more search queries to run in parallel"),
        limit: z.number().int().min(1).max(100).default(10)
          .describe("Max results per query (default 10)"),
        timeout: z.number().int().min(1000).default(60_000)
          .describe("Page-load timeout in ms (default 60000)"),
        noSaveState: z.boolean().default(false)
          .describe("If true, do not persist or load browser state"),
        locale: z.string().default("en-US")
          .describe('BCP-47 locale for results, e.g. "en-US"'),
        debug: z.boolean().default(false)
          .describe("Show browser window"),
        stateDir: z.string().default("./browser-state")
          .describe("Directory for browser state persistence files"),
      }),
      annotations: {
        readOnlyHint: true, destructiveHint: false,
        idempotentHint: false, openWorldHint: true,
      },
    },
    async ({ queries, limit, timeout, noSaveState, locale, debug, stateDir }) => {
      try {
        // Each parallel query gets its own state file (avoids cross-contamination)
        // but they all share the same persisted domain/fingerprint config.
        const settled = await Promise.allSettled(
          queries.map((q, i) => {
            const stateFile = path.join(stateDir, `browser-state-${i}.json`);
            const savedState = loadState(stateFile);
            return searchOne(q, limit, timeout, locale, noSaveState, debug, stateFile, savedState);
          })
        );

        const searches: QueryResult[] = settled.map((r, i) => {
          if (r.status === "fulfilled") return r.value;
          return { query: queries[i] ?? "", results: [] };
        });

        return {
          content: [{ type: "text", text: JSON.stringify({ searches } as SearchOutput, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Search error: ${message}` }], isError: true };
      }
    }
  );
}
