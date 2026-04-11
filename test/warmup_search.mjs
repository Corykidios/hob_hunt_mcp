/**
 * hunt_search warm-up script
 * 
 * Runs a single visible Google search to seed the browser-state file.
 * After this runs successfully once, all future headless searches use
 * the saved session and return results reliably.
 *
 * Usage:
 *   node test/warmup_search.mjs
 *
 * The browser window will open visibly. If Google shows a CAPTCHA,
 * solve it in the window — the script will wait up to 2 minutes.
 * On success the state file is saved and the browser closes.
 */

// Pull search internals out of the compiled build
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir  = path.resolve(__dirname, "../build");

// ── Inline the searchOne logic (avoids MCP server overhead) ─────────────────
// We import playwright-extra directly, same as the server does.

// @ts-ignore
const { chromium: stealthChromium } = await import("playwright-extra");
// @ts-ignore
const { default: StealthPlugin }    = await import("puppeteer-extra-plugin-stealth");
import fs   from "fs";
import fsP  from "fs/promises";

stealthChromium.use(StealthPlugin());

const STATE_DIR  = path.resolve(__dirname, "../browser-state");
const STATE_FILE = path.join(STATE_DIR, "browser-state-0.json");
const FP_FILE    = STATE_FILE.replace(".json", "-fingerprint.json");

const QUERY   = "Ancient Greek alphabet";
const TIMEOUT = 120_000;

const GOOGLE_DOMAINS = [
  "https://www.google.com",
  "https://www.google.co.uk",
];

const CAPTCHA_PATTERNS = [
  "google.com/sorry/index", "google.com/sorry", "recaptcha", "captcha", "unusual traffic",
];

function isBlocked(url) {
  return CAPTCHA_PATTERNS.some((p) => url.includes(p));
}

const RESULT_SELECTORS = [
  { container: "#search .g",   title: "h3", snippet: ".VwiC3b" },
  { container: "#rso .g",      title: "h3", snippet: ".VwiC3b" },
  { container: ".g",           title: "h3", snippet: ".VwiC3b" },
];

console.log("\n🔍  hunt_search warm-up");
console.log("    Query   :", QUERY);
console.log("    State   :", STATE_FILE);
console.log("    Browser : VISIBLE (headless=false)\n");

const browser = await stealthChromium.launch({
  headless: false,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
});

const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  locale: "en-US",
  viewport: { width: 1280, height: 800 },
  javaScriptEnabled: true,
});

await context.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => false });
  Object.defineProperty(navigator, "plugins",   { get: () => [1,2,3,4,5] });
  window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
});

const page = await context.newPage();
// NOTE: Do NOT block images here — CAPTCHA grids must load for manual solving.

const domain = GOOGLE_DOMAINS[Math.floor(Math.random() * GOOGLE_DOMAINS.length)];
console.log("    Navigating to", domain, "...");
await page.goto(domain, { waitUntil: "networkidle", timeout: TIMEOUT });

if (isBlocked(page.url())) {
  console.log("    ⚠️  CAPTCHA detected — solve it in the browser window (2 min timeout)...");
  await page.waitForNavigation({
    timeout: 120_000,
    url: (u) => !isBlocked(u.toString()),
  }).catch(() => {});
}

// Find search box
let input = null;
for (const sel of ["textarea[name='q']", "input[name='q']", "textarea[title='Search']", "textarea"]) {
  input = await page.$(sel);
  if (input) break;
}
if (!input) throw new Error("Could not find Google search box");

console.log("    Typing query...");
await input.click();
await page.keyboard.type(QUERY, { delay: 20 });
await page.waitForTimeout(300);

console.log("    Submitting...");
await page.keyboard.press("Enter");
await page.waitForLoadState("networkidle", { timeout: TIMEOUT }).catch(() => {});

if (isBlocked(page.url())) {
  console.log("    ⚠️  CAPTCHA on results — solve it in the browser window...");
  await page.waitForNavigation({
    timeout: 120_000,
    url: (u) => !isBlocked(u.toString()),
  }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: TIMEOUT }).catch(() => {});
}

// Wait for result containers
let found = false;
for (const sel of ["#search", "#rso", ".g", "div[role='main']"]) {
  try {
    await page.waitForSelector(sel, { timeout: 15_000 });
    found = true;
    break;
  } catch { /* try next */ }
}

// Extract results
let results = [];
for (const sel of RESULT_SELECTORS) {
  try {
    results = await page.$$eval(
      sel.container,
      (els, params) => els.slice(0, 5).map((el) => ({
        title:   el.querySelector(params.title)?.innerText?.trim() ?? "",
        link:    el.querySelector("a")?.href ?? "",
        snippet: el.querySelector(params.snippet)?.innerText?.trim() ?? "",
      })).filter((r) => r.title && r.link),
      { title: sel.title, snippet: sel.snippet }
    );
    if (results.length > 0) break;
  } catch { /* try next */ }
}

console.log(`\n    Results found: ${results.length}`);
results.forEach((r, i) => console.log(`    [${i+1}] ${r.title}\n        ${r.link}`));

// Save state
if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
await context.storageState({ path: STATE_FILE });
const fp = { fingerprint: { deviceName: "Desktop Chrome", locale: "en-US", timezoneId: "America/New_York", colorScheme: "light" } };
fs.writeFileSync(FP_FILE, JSON.stringify(fp, null, 2));

console.log("\n    ✅  State saved to:", STATE_FILE);
console.log("    ✅  Future headless searches will use this session.\n");

await browser.close();
process.exit(results.length > 0 ? 0 : 1);
