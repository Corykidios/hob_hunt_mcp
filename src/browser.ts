import { Browser, BrowserContext, chromium } from "playwright";

// ---------------------------------------------------------------------------
// BrowserManager
// A single shared Playwright Chromium instance, lazy-initialized on first use.
// All three tools (hob_search, hob_site, hob_sites) draw from this same pool
// rather than each spinning up their own browser process.
// ---------------------------------------------------------------------------

export interface BrowserOptions {
  debug?: boolean;
}

let browser: Browser | null = null;
let debugMode = false;

/** Call once at startup if --debug was passed on the CLI. */
export function setGlobalDebug(value: boolean): void {
  debugMode = value;
}

export function getGlobalDebug(): boolean {
  return debugMode;
}

/** Lazy-initialize and return the shared browser instance. */
export async function getBrowser(opts: BrowserOptions = {}): Promise<Browser> {
  const headless = !(opts.debug ?? debugMode);

  // If debug state changed, tear down the existing browser so it respawns correctly.
  if (browser && !headless !== browser.isConnected()) {
    await browser.close().catch(() => undefined);
    browser = null;
  }

  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ headless });
  }

  return browser;
}

/** Create a fresh context (each tool call gets its own isolated context). */
export async function newContext(opts: BrowserOptions = {}): Promise<BrowserContext> {
  const b = await getBrowser(opts);
  return b.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
  });
}

/** Gracefully close the shared browser (e.g., on process exit). */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => undefined);
    browser = null;
  }
}
