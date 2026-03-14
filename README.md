You come to in a strange, white room (black if you dig dark mode, I suppose), and before you can even chance a glance at wherever the fuck you even are, you feel a sharp little tug at the back of a pant leg (yes, you are wearing pants, and yes, you found them on the ground at Ross, and yes, you tell all of your friends that the bed bugs it brought along aren't even that big of a deal anymore).

You whirl around but must quickly look down to see a, like, a little weird thing… like… It is then that you cast your gaze up and and a little to the left to light upon a GitHub profile picture, and yeah, it's like that. A Hob. Probably the freaking cutest one that ever did live, too. It chirps out a yip or two (and perhaps even a hoot and a holler if you're feeling adventurous), "Ἔξω ἐμὸς θάλαμος!" Great. It's speaking in the tongues of demons, no doubt, and you're probably cursed.

As your thoughts drift towards how excited you'll be to share this experience with the bed bugs back home, the little shit chomps into your ankle before scurrying off down a hole that I intended to be there all along, really, you just don't appreciate all the care and forethought I put into this nondescript white room and its glorious hole, oh, the glory of that hole, and then back out he pops, waddling your way with his squat little arms wrapped around a scroll that looms over his itty bitty two foot frame, with which he smacks you a few times before handing it over.

A ghostly voice creeps forth out of the hole, I guess, and you can barely make out its haunted command, "Read… Me… Reeeeaaaadmeeeeee…"

Yeah, you abused your poor aching eyes through all this weird shit just to find that this intro is absolutely unnecessary, and now that fucking Hob has somehow stolen your burgundy dress-for-less big-boy britches.

You wonder if you'll ever see Bill and Boogity Bed Bug again and hope the left pocket treats them well before you unfurl the surprisingly unremarkable README scroll.

---

# hob_hunt_mcp

A unified MCP server for web search and page fetching, built on Playwright.

Three tools. One browser process. No redundancy.

---

## Tools

What's that? Your g-search homie-fetch tools are evolving?!
And into the exact same things with silly names, no less! On the shoulders of giants, we stand, damnit!
1. fetch-url became "hob_site"
2. fetch-urls became "hob_sites"
3. search became "hob_search".
4. we don't talk about that one.

### `hob_site`
Fetch the content of a single web page. Because it uses a real Playwright browser under the hood, it handles JavaScript-rendered content, redirects, and anti-bot pages that would stump a plain HTTP request. Content is returned as Markdown by default, with optional Readability extraction to strip away navigation, ads, and other noise.

### `hob_sites`
The same as `hob_site`, but for multiple URLs at once. Pages are fetched in parallel and returned as a single combined document.

### `hob_search`
Execute one or more Google searches in parallel. Provide an array of queries and receive structured JSON results — titles, links, and snippets — for all of them at once.

The hob scurries back out wearing a pot on his head and sporting an old-timey gramophone, which, upon being cranked, groans forth, "A fourth utility tool, `bed_bug_burgundy_big_boy_britches_browser_install`, is also included for first-time setup, and it is not named cleverly because I absolutely forgot about it. I blame both Claude and the government."

---

## Why a unified server?

`hob_search` and the fetch tools share the same Playwright Chromium dependency. Running them as separate servers means two browser processes. Running them together means one — and the result is leaner, faster, and tidier in your MCP configuration.

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Install the Playwright browser

```bash
npm run install-browser
```

Or let the MCP agent call `bed_bug_burgundy_big_boy_britches_browser_install` for you on first use.

### 3. Build

```bash
npm run build
```

### 4. Configure in Claude Desktop

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

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

### 5. Debug mode

Pass `--debug` to show the browser window — useful when a CAPTCHA needs solving:

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

### `hob_search`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `queries` | `string[]` | *(required)* | Search queries to run in parallel |
| `limit` | `number` | `10` | Max results per query (up to 100) |
| `timeout` | `number` | `30000` | Page-load timeout in ms |
| `locale` | `string` | `"en-US"` | BCP-47 locale for results |
| `debug` | `boolean` | `false` | Show browser window |

**Returns:** JSON — `{ searches: [{ query, results: [{ title, link, snippet }] }] }`

---

### `hob_site`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | `string` | *(required)* | The URL to fetch |
| `timeout` | `number` | `30000` | Page-load timeout in ms |
| `waitUntil` | `string` | `"load"` | `load`, `domcontentloaded`, `networkidle`, or `commit` |
| `extractContent` | `boolean` | `true` | Strip noise via Readability; return only main content |
| `maxLength` | `number` | *(none)* | Truncate output to this many characters |
| `returnHtml` | `boolean` | `false` | Return HTML instead of Markdown |
| `waitForNavigation` | `boolean` | `false` | Wait for a second navigation |
| `navigationTimeout` | `number` | `10000` | Timeout for the extra navigation wait |
| `disableMedia` | `boolean` | `true` | Block images, fonts, and media |
| `debug` | `boolean` | `false` | Show browser window |

**Returns:** Page content as Markdown (or HTML), prefixed with title and URL.

---

### `hob_sites`

Accepts all the same parameters as `hob_site`, plus:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `urls` | `string[]` | *(required)* | URLs to fetch in parallel |

**Returns:** Combined content from all pages, separated by horizontal rules.

---

### `bed_bug_burgundy_big_boy_britches_browser_install`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `withDeps` | `boolean` | `false` | Also install system-level Chromium dependencies (Linux) |
| `force` | `boolean` | `false` | Reinstall even if Chromium is already present |

---

## Requirements

- Node.js 18 or higher
- npm

---

## Development

```bash
# Watch mode (auto-rebuild on save)
npm run dev

# Run directly
npm start
```

---

## License

MIT

---

## With Many Thanks

This project is built directly on the shoulders of two excellent open-source MCP servers by **[jae-jae](https://github.com/jae-jae)**:

- **[g-search-mcp](https://github.com/jae-jae/g-search-mcp)** — the Google search tool that `hob_search` is derived from
- **[fetcher-mcp](https://github.com/jae-jae/fetcher-mcp)** — the Playwright fetch server that `hob_site` and `hob_sites` are derived from

Both are well-designed, well-documented, and actively maintained. If you find value in `hob_hunt_mcp`, please consider starring those original repositories. The work here would not exist without them as I have no idea how to even make these damn things.
