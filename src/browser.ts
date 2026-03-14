// @ts-ignore — playwright-extra and stealth plugin lack full TS declarations
import { chromium as stealthChromium } from "playwright-extra";
// @ts-ignore
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext } from "playwright";

// ---------------------------------------------------------------------------
// BrowserManager
// A single shared Playwright-Extra + Stealth instance, lazy-initialized on
// first use. Stealth patches all headless fingerprints that trigger CAPTCHAs
// on Google, DuckDuckGo, and similar bot-detecting search engines.
//
// All three tools (hob_search, hob_site, hob_sites) share this one browser
// process rather than each spinning up their own.
// ---------------------------------------------------------------------------

export interface BrowserOptions {
  debug?: boolean;
}

let browser: Browser | null = null;
let debugMode = false;
let stealthRegistered = false;

/** Call once at startup if --debug was passed on the CLI. */
export function setGlobalDebug(value: boolean): void {
  debugMode = value;
}

export function getGlobalDebug(): boolean {
  return debugMode;
}

/** Lazy-initialize and return the shared stealth browser instance. */
export async function getBrowser(opts: BrowserOptions = {}): Promise<Browser> {
  const headless = !(opts.debug ?? debugMode);

  if (!stealthRegistered) {
    stealthChromium.use(StealthPlugin());
    stealthRegistered = true;
  }

  if (browser && !browser.isConnected()) {
    await browser.close().catch(() => undefined);
    browser = null;
  }

  if (!browser || !browser.isConnected()) {
    browser = await stealthChromium.launch({
      headless,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
    }) as unknown as Browser;
  }

  return browser;
}

/** Create a fresh context per tool call. */
export async function newContext(opts: BrowserOptions = {}): Promise<BrowserContext> {
  const b = await getBrowser(opts);
  return (b as unknown as { newContext: (o: object) => Promise<BrowserContext> }).newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
  });
}

/** Gracefully shut down the shared browser. */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => undefined);
    browser = null;
  }
}
