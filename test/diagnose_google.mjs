/**
 * Google DOM diagnostic — v2
 * Handles cookie consent modals, tries click-submit fallback,
 * waits for URL change before reading content.
 */

const { chromium: stealthChromium } = await import("playwright-extra");
const { default: StealthPlugin }    = await import("puppeteer-extra-plugin-stealth");
import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.resolve(__dirname, "../browser-state/browser-state-0.json");
const OUT_HTML   = path.resolve(__dirname, "../browser-state/last_results.html");

stealthChromium.use(StealthPlugin());

const browser = await stealthChromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

const ctxOpts = {
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  locale: "en-US",
  timezoneId: "America/New_York",
  viewport: { width: 1280, height: 800 },
};
if (fs.existsSync(STATE_FILE)) {
  ctxOpts.storageState = STATE_FILE;
  console.log("  Using saved state:", STATE_FILE);
}

const context = await browser.newContext(ctxOpts);
await context.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => false });
  window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
});

const page = await context.newPage();
await page.route("**/*", (route) => {
  const t = route.request().resourceType();
  if (["image","font","media"].includes(t)) route.abort().catch(() => {});
  else route.continue().catch(() => {});
});

// ── Navigate to Google ───────────────────────────────────────────────────────
console.log("  Navigating to google.com...");
await page.goto("https://www.google.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
await page.waitForTimeout(1500);
console.log("  URL after load:", page.url());

// ── Dismiss cookie/consent modal if present ──────────────────────────────────
const consentSelectors = [
  "button[id='L2AGLb']",          // "Accept all" (en-US)
  "button[aria-label='Accept all']",
  "button[aria-label='Agree to the use of cookies and other data for the purposes described']",
  "form[action*='consent'] button",
  "#CXQnmb",
  "div[role='dialog'] button:last-child",
];
for (const sel of consentSelectors) {
  const btn = await page.$(sel);
  if (btn) {
    const txt = await btn.innerText().catch(() => "");
    console.log(`  Dismissing consent modal: "${sel}" text="${txt}"`);
    await btn.click();
    await page.waitForTimeout(1000);
    break;
  }
}

// ── Dump homepage snippet to see what's on page ──────────────────────────────
const bodyText = await page.$eval("body", (b) => b.innerText?.slice(0, 300)).catch(() => "");
console.log("  Body preview:", bodyText.replace(/\n+/g, " ").slice(0, 200));

// ── Find search input ────────────────────────────────────────────────────────
let input = null;
for (const sel of ["textarea[name='q']","input[name='q']","textarea[title='Search']","input[title='Google Search']","textarea"]) {
  input = await page.$(sel);
  if (input) { console.log("  Input found via:", sel); break; }
}
if (!input) {
  console.log("  ERROR: no search input. Saving homepage HTML for inspection.");
  fs.writeFileSync(OUT_HTML, await page.content(), "utf8");
  await browser.close();
  process.exit(1);
}

// ── Type query ───────────────────────────────────────────────────────────────
await input.focus();
await page.waitForTimeout(300);
await page.keyboard.type("Ancient Greek alphabet", { delay: 20 });
await page.waitForTimeout(500);

// ── Submit via Enter, fall back to clicking the search button ────────────────
console.log("  Submitting...");
const [navResult] = await Promise.allSettled([
  page.waitForURL((url) => url.href.includes("/search"), { timeout: 15_000 }),
  page.keyboard.press("Enter"),
]);

if (navResult.status !== "fulfilled") {
  console.log("  Enter didn't navigate — trying click submit button...");
  const submitSelectors = [
    "input[name='btnK']", "button[aria-label='Google Search']",
    "input[type='submit']", "button[type='submit']",
  ];
  for (const sel of submitSelectors) {
    const btn = await page.$(sel);
    if (btn) {
      await btn.click();
      await page.waitForURL((url) => url.href.includes("/search"), { timeout: 15_000 }).catch(() => {});
      break;
    }
  }
}

await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
console.log("  Final URL:", page.url());

// ── Dump HTML ────────────────────────────────────────────────────────────────
const html = await page.content().catch(() => "");
if (html) {
  fs.writeFileSync(OUT_HTML, html, "utf8");
  console.log("  Saved HTML:", OUT_HTML, `(${html.length} bytes)`);
}

// ── Selector probe ───────────────────────────────────────────────────────────
const selectors = [
  "#search .g", "#rso .g", ".g",
  "#search div[data-hveid]", "[data-sokoban-container] > div",
  ".MjjYud", ".tF2Cxc", ".N54PNb", ".yuRUbf",
  "#search h3", "#rso h3", "h3",
];
console.log("\n  Selector probe:");
for (const sel of selectors) {
  try {
    const count = await page.$$eval(sel, (els) => els.length);
    if (count > 0) console.log(`  ✅  ${String(count).padStart(3)} ×  ${sel}`);
  } catch { /* skip */ }
}

// ── h3 texts ─────────────────────────────────────────────────────────────────
const h3s = await page.$$eval("h3", (els) =>
  els.slice(0, 10).map((e) => e.innerText?.trim()).filter(Boolean)
).catch(() => []);
if (h3s.length) {
  console.log("\n  h3 texts:");
  h3s.forEach((t) => console.log(`    • ${t}`));
}

// ── First few anchor texts ────────────────────────────────────────────────────
const links = await page.$$eval("a[href^='http']", (els) =>
  els.slice(0, 8).map((e) => ({ text: e.innerText?.trim()?.slice(0,60), href: e.href?.slice(0,80) }))
    .filter((l) => l.text && !l.href.includes("google.com/"))
).catch(() => []);
if (links.length) {
  console.log("\n  Non-Google links found:");
  links.forEach((l) => console.log(`    • ${l.text}  →  ${l.href}`));
}

await browser.close();
console.log("\n  Done.");
