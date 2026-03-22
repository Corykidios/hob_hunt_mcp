# hob_hunt_mcp

A unified MCP server for web search and page fetching, built on Playwright.

Two tools. One browser process. No redundancy.

---

## Tools

### `hunt_site`

Fetch one or more web pages using a stealth Playwright browser. Handles JavaScript-rendered content, redirects, anti-bot detection, and lazy-loaded content. Single URL or many — always pass an array.

Two modes:

- **fetch** *(default)* — Return page content as clean Markdown (or raw HTML).
- **map** — Return a JSON list of all URLs discovered on the page. Useful for site exploration before you decide what to fetch.

Set `pages` greater than 1 to follow same-domain links breadth-first, up to that many total pages — a lightweight site crawl without any extra dependencies.

Results for the same URL and options are cached in memory for the session (5-minute TTL), so repeated fetches inside a single agent run are instant.

### `hunt_search`

Perform one or more Google searches in parallel using a stealth browser with human-like navigation and persistent session state. Pass multiple queries at once and get all results back in a single structured JSON response.

Set `fetchTopN` to automatically fetch the content of the top N result pages per query and append it to the response — search and read in one shot. Fetched pages are always sandboxed in `EXTERNAL CONTENT` delimiters.

On first run against a fresh IP, Google may show a CAPTCHA. Run the warmup script once (see below) to seed a valid session file — all future headless searches use it automatically.

---

## Quick Start

### 1. Install dependencies

```
npm install
```

### 2. Install the Playwright browser

```
npm run install-browser
```

### 3. Build

```
npm run build
```

### 4. Warm up the search session (first time only)

This opens a visible browser window and runs a real Google search to seed the persistent session file. Do it once — all headless searches after this use the saved session.

```
node test/warmup_search.mjs
```

If Google shows a CAPTCHA in the browser window, solve it manually. The script waits up to two minutes, then saves the session and closes.

### 5. Configure in your MCP client

**Claude Desktop** — `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "hob_hunt": {
      "command": "node",
      "args": ["C:/c/apps/servers/hob_hunt_mcp/build/index.js"]
    }
  }
}
```

**Debug mode** (opens visible browser — useful for diagnosing CAPTCHA or inspecting pages):

```json
{
  "mcpServers": {
    "hob_hunt": {
      "command": "node",
      "args": ["C:/c/apps/servers/hob_hunt_mcp/build/index.js", "--debug"]
    }
  }
}
```

---

## Tool Reference

### `hunt_site`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `urls` | `string[]` | *(required)* | URLs to fetch. Multiple URLs are fetched in parallel. |
| `mode` | `string` | `"fetch"` | `fetch` = return content; `map` = return discovered URLs |
| `pages` | `number` | `1` | Max pages to crawl per starting URL following same-domain links (1–20) |
| `timeout` | `number` | `30000` | Page-load timeout in ms |
| `waitUntil` | `string` | `"load"` | Navigation signal: `load`, `domcontentloaded`, `networkidle`, `commit` |
| `extractContent` | `boolean` | `true` | Strip navigation/ads via Readability; return only main content |
| `maxLength` | `number` | `0` | Truncate output to this many characters (0 = no limit) |
| `returnHtml` | `boolean` | `false` | Return raw HTML instead of Markdown |
| `selector` | `string` | `""` | CSS selector — extract only matching elements (empty = full page) |
| `waitForSelector` | `string` | `""` | Wait for this CSS selector to appear before extracting |
| `scrollToBottom` | `boolean` | `false` | Auto-scroll to trigger lazy-loaded content |
| `extractLinks` | `boolean` | `false` | Append a list of all outbound links found on the page |
| `sandbox` | `boolean` | `false` | Wrap output in `EXTERNAL CONTENT` security delimiters |
| `waitForNavigation` | `boolean` | `false` | Wait for a second navigation after initial load |
| `navigationTimeout` | `number` | `10000` | Timeout for the extra navigation wait in ms |
| `disableMedia` | `boolean` | `true` | Block images, stylesheets, fonts, and media |
| `debug` | `boolean` | `false` | Show the browser window |

**Returns (fetch mode):** Page content as Markdown (or HTML), prefixed with title and URL. Multiple pages separated by horizontal rules.

**Returns (map mode):** JSON — `{ source, links: string[] }`

---

### `hunt_search`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `queries` | `string[]` | *(required)* | Search queries to run in parallel |
| `limit` | `number` | `10` | Max results per query (up to 100) |
| `timeout` | `number` | `60000` | Page-load timeout in ms |
| `fetchTopN` | `number` | `0` | Auto-fetch the top N result pages per query and append content (0–5) |
| `noSaveState` | `boolean` | `false` | Skip saving/loading persistent browser session |
| `locale` | `string` | `"en-US"` | BCP-47 locale for results |
| `debug` | `boolean` | `false` | Show the browser window (use to solve CAPTCHA manually) |
| `stateDir` | `string` | *(see below)* | Directory for persistent browser session files |

**Returns:** JSON — `{ searches: [{ query, results: [{ title, link, snippet }] }] }`

With `fetchTopN` > 0, also returns fetched page content sections appended below the JSON, each wrapped in `EXTERNAL CONTENT` security delimiters.

**Default `stateDir`:** `C:/c/apps/servers/hob_hunt_mcp/browser-state`

---

## Why a Unified Server?

`hunt_search` and `hunt_site` share the same Playwright Chromium dependency and the same stealth browser singleton. Running them as separate servers means two browser processes and two MCP config entries. Running them together means one of each — leaner, faster, and tidier.

---

## Requirements

- Node.js 18 or higher
- npm

---

## Development

```bash
# Watch mode (auto-rebuild on save)
npm run dev

# Build
npm run build

# Run integration tests
node test/run_tests.mjs

# Warm up search session (first time)
node test/warmup_search.mjs

# Diagnose Google DOM structure (if search returns 0 results)
node test/diagnose_google.mjs
```

---

## License

MIT

---

## With Many Thanks

This project is built directly on the shoulders of two excellent open-source MCP servers by **[jae-jae](https://github.com/jae-jae)**:

- **[g-search-mcp](https://github.com/jae-jae/g-search-mcp)** — the Google search tool that `hunt_search` is derived from
- **[fetcher-mcp](https://github.com/jae-jae/fetcher-mcp)** — the Playwright fetch server that `hunt_site` is derived from

Both are thoughtfully designed, well-documented, and actively maintained. The fingerprinting, stealth browser management, session persistence, and multi-selector extraction strategy that make this server actually work in the real world all trace back to jae-jae's original implementation. If you find value here, please consider starring those repositories. None of this would exist without them — and I say that as someone who did not fully understand what I was doing when I started.