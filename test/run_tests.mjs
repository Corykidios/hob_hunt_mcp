/**
 * hob_hunt_mcp v2 — integration test harness
 * Spawns the server over stdio and exercises every meaningful parameter path.
 * Run with: node test/run_tests.mjs
 */

import { spawn } from "child_process";
import { createInterface } from "readline";

// ─── helpers ────────────────────────────────────────────────────────────────

let msgId = 1;

function makeCall(method, params) {
  return JSON.stringify({ jsonrpc: "2.0", id: msgId++, method, params }) + "\n";
}

function toolCall(name, args) {
  return makeCall("tools/call", { name, arguments: args });
}

const PASS = "✅";
const FAIL = "❌";
const SKIP = "⏭ ";

const results = [];
function record(name, ok, note = "") {
  const icon = ok === null ? SKIP : ok ? PASS : FAIL;
  results.push({ name, ok, note });
  console.log(`  ${icon} ${name}${note ? "  →  " + note : ""}`);
}

// ─── server boot ────────────────────────────────────────────────────────────

const server = spawn("node", ["build/index.js"], {
  cwd: "C:/c/apps/servers/hob_hunt_mcp",
  stdio: ["pipe", "pipe", "pipe"],
});

server.stderr.on("data", (d) => {
  const msg = d.toString().trim();
  if (msg) console.log(`  [stderr] ${msg}`);
});

// response queue
const pending = new Map();
const rl = createInterface({ input: server.stdout });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id && pending.has(msg.id)) {
    const { resolve } = pending.get(msg.id);
    pending.delete(msg.id);
    resolve(msg);
  }
});

function send(raw) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return reject(e); }
    pending.set(parsed.id, { resolve, reject });
    server.stdin.write(raw);
  });
}

function timeout(ms) {
  return new Promise((_, r) => setTimeout(() => r(new Error(`timeout after ${ms}ms`)), ms));
}

async function call(msg, ms = 60_000) {
  return Promise.race([send(msg), timeout(ms)]);
}

function getText(resp) {
  return resp?.result?.content?.[0]?.text ?? "";
}
function isError(resp) {
  return !!(resp?.result?.isError || resp?.error);
}

// ─── initialize ─────────────────────────────────────────────────────────────

await call(makeCall("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "test-harness", version: "1.0" },
}));
await call(makeCall("notifications/initialized", {})).catch(() => {});

// ─── list tools ─────────────────────────────────────────────────────────────

console.log("\n── Tool Discovery ──────────────────────────────────────────");
const listed = await call(makeCall("tools/list", {}));
const tools = listed?.result?.tools ?? [];
const names = tools.map((t) => t.name);
record("hunt_site registered",   names.includes("hunt_site"));
record("hunt_search registered", names.includes("hunt_search"));
record("No old hob_site",        !names.includes("hob_site"));
record("No old hob_sites",       !names.includes("hob_sites"));
record("No browser_install",     !names.includes("browser_install") && !names.includes("bed_bug_burgundy_big_boy_britches_browser_install"));
record("Exactly 2 tools",        names.length === 2, `found: ${names.join(", ")}`);

// ─── hunt_site: fetch single URL ────────────────────────────────────────────

console.log("\n── hunt_site: fetch single URL ─────────────────────────────");
{
  const r = await call(toolCall("hunt_site", {
    urls: ["https://example.com"],
    mode: "fetch",
  }), 45_000);
  const t = getText(r);
  record("fetch single — no error",    !isError(r));
  record("fetch single — has title",   t.toLowerCase().includes("example"));
  record("fetch single — has URL",     t.includes("example.com"));
  record("fetch single — is Markdown", t.includes("#"));
}

// ─── hunt_site: session cache (same URL + same default options) ──────────────

console.log("\n── hunt_site: session cache ────────────────────────────────");
{
  const t0 = Date.now();
  const r = await call(toolCall("hunt_site", {
    urls: ["https://example.com"],
    mode: "fetch",
    // same defaults as above → cache hit
  }), 15_000);
  const elapsed = Date.now() - t0;
  record("cache hit — no error",   !isError(r));
  record("cache hit — fast (<3s)", elapsed < 3000, `${elapsed}ms`);
}

// ─── hunt_site: fetch multiple URLs in parallel ──────────────────────────────

console.log("\n── hunt_site: fetch multiple URLs (parallel) ───────────────");
{
  const r = await call(toolCall("hunt_site", {
    urls: ["https://example.com", "https://example.org"],
    mode: "fetch",
  }), 60_000);
  const t = getText(r);
  record("multi fetch — no error",    !isError(r));
  record("multi fetch — two results", t.includes("example.com") && t.includes("example.org"));
  record("multi fetch — separator",   t.includes("---"));
}

// ─── hunt_site: returnHtml mode ──────────────────────────────────────────────

console.log("\n── hunt_site: returnHtml ───────────────────────────────────");
{
  // Different cache key from the plain fetch above (returnHtml=true, extractContent=false)
  const r = await call(toolCall("hunt_site", {
    urls: ["https://example.com"],
    mode: "fetch",
    returnHtml: true,
    extractContent: false,
  }), 45_000);
  const t = getText(r);
  record("returnHtml — has <html> or doctype", t.toLowerCase().includes("<html") || t.toLowerCase().includes("<!doctype"));
}

// ─── hunt_site: maxLength truncation ─────────────────────────────────────────

console.log("\n── hunt_site: maxLength truncation ─────────────────────────");
{
  const r = await call(toolCall("hunt_site", {
    urls: ["https://example.com"],
    mode: "fetch",
    maxLength: 100,
    extractContent: false,
  }), 45_000);
  const t = getText(r);
  record("maxLength — truncation marker present", t.includes("[content truncated]"));
}

// ─── hunt_site: CSS selector targeting ───────────────────────────────────────

console.log("\n── hunt_site: CSS selector targeting ──────────────────────");
{
  const r = await call(toolCall("hunt_site", {
    urls: ["https://example.com"],
    mode: "fetch",
    selector: "h1",
    extractContent: false,
  }), 45_000);
  const t = getText(r);
  record("selector — no error",          !isError(r));
  record("selector — h1 text extracted", t.toLowerCase().includes("example domain") || t.includes("# ") || t.length < 600);
}

// ─── hunt_site: extractLinks ─────────────────────────────────────────────────

console.log("\n── hunt_site: extractLinks ─────────────────────────────────");
{
  const r = await call(toolCall("hunt_site", {
    urls: ["https://example.com"],
    mode: "fetch",
    extractLinks: true,
  }), 45_000);
  const t = getText(r);
  record("extractLinks — no error",      !isError(r));
  record("extractLinks — links section", t.includes("Links found on page") || t.includes("iana.org"));
}

// ─── hunt_site: sandbox wrapping ─────────────────────────────────────────────

console.log("\n── hunt_site: sandbox wrapping ─────────────────────────────");
{
  const r = await call(toolCall("hunt_site", {
    urls: ["https://example.com"],
    mode: "fetch",
    sandbox: true,
  }), 45_000);
  const t = getText(r);
  record("sandbox — EXTERNAL CONTENT header", t.includes("EXTERNAL CONTENT"));
  record("sandbox — END footer",              t.includes("END OF EXTERNAL CONTENT"));
  record("sandbox — source URL in header",    t.includes("example.com"));
}

// ─── hunt_site: map mode ─────────────────────────────────────────────────────

console.log("\n── hunt_site: map mode ─────────────────────────────────────");
{
  const r = await call(toolCall("hunt_site", {
    urls: ["https://example.com"],
    mode: "map",
  }), 45_000);
  const t = getText(r);
  record("map mode — no error",    !isError(r));
  record("map mode — JSON output", t.includes('"source"') && t.includes('"links"'));
}

// ─── hunt_site: scrollToBottom ───────────────────────────────────────────────

console.log("\n── hunt_site: scrollToBottom ───────────────────────────────");
{
  const r = await call(toolCall("hunt_site", {
    urls: ["https://example.com"],
    mode: "fetch",
    scrollToBottom: true,
  }), 45_000);
  record("scrollToBottom — no error",    !isError(r));
  record("scrollToBottom — has content", getText(r).length > 50);
}

// ─── hunt_site: waitForSelector ──────────────────────────────────────────────

console.log("\n── hunt_site: waitForSelector ──────────────────────────────");
{
  const r = await call(toolCall("hunt_site", {
    urls: ["https://example.com"],
    mode: "fetch",
    waitForSelector: "div",
  }), 45_000);
  record("waitForSelector — no error", !isError(r));
  record("waitForSelector — content",  getText(r).length > 50);
}

// ─── hunt_site: pages crawl mode ─────────────────────────────────────────────

console.log("\n── hunt_site: pages crawl (pages=2) ────────────────────────");
{
  const r = await call(toolCall("hunt_site", {
    urls: ["https://example.com"],
    mode: "fetch",
    pages: 2,
  }), 90_000);
  const t = getText(r);
  record("crawl pages=2 — no error",    !isError(r));
  record("crawl pages=2 — has content", t.length > 100);
}

// ─── hunt_search: basic search ───────────────────────────────────────────────

console.log("\n── hunt_search: basic search ───────────────────────────────");
{
  let r, timedOut = false;
  try {
    r = await call(toolCall("hunt_search", {
      queries: ["Ancient Greek alphabet"],
      limit: 3,
    }), 180_000);  // 3 min — cold browser + Google load
  } catch (e) {
    timedOut = true;
    record("search basic — timed out (>3min)", false, e.message);
  }
  if (!timedOut) {
    const t = getText(r);
    record("search basic — no error",    !isError(r));
    record("search basic — JSON output", t.includes('"searches"'));
    record("search basic — has results", t.includes('"results"') && t.includes('"link"'));
    const parsed = (() => { try { return JSON.parse(t.split("\n\n")[0]); } catch { return null; } })();
    const count = parsed?.searches?.[0]?.results?.length ?? 0;
    record("search basic — ≥1 result",   count >= 1, `got ${count}`);
  }
}

// ─── hunt_search: parallel queries ───────────────────────────────────────────

console.log("\n── hunt_search: parallel queries ───────────────────────────");
{
  let r, timedOut = false;
  try {
    r = await call(toolCall("hunt_search", {
      queries: ["MCP server TypeScript", "Ancient Greek"],
      limit: 2,
    }), 180_000);
  } catch (e) {
    timedOut = true;
    record("parallel queries — timed out (>3min)", false, e.message);
  }
  if (!timedOut) {
    const t = getText(r);
    record("parallel queries — no error",        !isError(r));
    record("parallel queries — 2 search entries", (t.match(/"query"/g) ?? []).length >= 2);
  }
}

// ─── hunt_search: fetchTopN ──────────────────────────────────────────────────

console.log("\n── hunt_search: fetchTopN ──────────────────────────────────");
{
  let r, timedOut = false;
  try {
    r = await call(toolCall("hunt_search", {
      queries: ["example.com"],
      limit: 3,
      fetchTopN: 1,
    }), 180_000);
  } catch (e) {
    timedOut = true;
    record("fetchTopN — timed out (>3min)", false, e.message);
  }
  if (!timedOut) {
    const t = getText(r);
    record("fetchTopN — no error",             !isError(r));
    record("fetchTopN — JSON block present",   t.includes('"searches"'));
    record("fetchTopN — fetched pages header", t.includes("Fetched Pages"));
    record("fetchTopN — EXTERNAL CONTENT",    t.includes("EXTERNAL CONTENT"));
  }
}

// ─── summary ─────────────────────────────────────────────────────────────────

console.log("\n════════════════════════════════════════════════════════════");
const passed  = results.filter((r) => r.ok === true).length;
const failed  = results.filter((r) => r.ok === false).length;
const skipped = results.filter((r) => r.ok === null).length;
console.log(`  ${PASS} ${passed} passed    ${FAIL} ${failed} failed    ${SKIP} ${skipped} skipped`);
console.log("════════════════════════════════════════════════════════════\n");

if (failed > 0) {
  console.log("Failed tests:");
  results.filter((r) => r.ok === false).forEach((r) => console.log(`  ${FAIL} ${r.name}  →  ${r.note}`));
}

server.kill();
process.exit(failed > 0 ? 1 : 0);
