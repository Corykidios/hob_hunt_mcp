import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { newContext } from "../browser.js";
import { execSync } from "child_process";

const FetchParamsBase = {
  timeout: z.number().int().min(1000).default(30_000)
    .describe("Page-load timeout in ms (default 30000)"),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle", "commit"]).default("load")
    .describe("Navigation completion signal"),
  extractContent: z.boolean().default(true)
    .describe("Use Readability to strip noise and return only main content"),
  maxLength: z.number().int().optional()
    .describe("Truncate returned content to this many characters"),
  returnHtml: z.boolean().default(false)
    .describe("Return raw HTML instead of Markdown"),
  waitForNavigation: z.boolean().default(false)
    .describe("Wait for a second navigation after initial load"),
  navigationTimeout: z.number().int().min(1000).default(10_000)
    .describe("Timeout for the extra navigation wait in ms"),
  disableMedia: z.boolean().default(true)
    .describe("Block images, stylesheets, fonts, and media"),
  debug: z.boolean().default(false)
    .describe("Show the browser window"),
};

interface FetchOptions {
  timeout: number;
  waitUntil: "load" | "domcontentloaded" | "networkidle" | "commit";
  extractContent: boolean;
  maxLength?: number;
  returnHtml: boolean;
  waitForNavigation: boolean;
  navigationTimeout: number;
  disableMedia: boolean;
  debug: boolean;
}

interface FetchResult {
  url: string;
  content: string;
  title: string;
}

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

async function fetchOne(url: string, opts: FetchOptions): Promise<FetchResult> {
  const context = await newContext({ debug: opts.debug });

  try {
    const page = await context.newPage();

    if (opts.disableMedia) {
      await page.route("**/*", (route) => {
        const type = route.request().resourceType();
        if (["image", "stylesheet", "font", "media"].includes(type)) {
          route.abort().catch(() => undefined);
        } else {
          route.continue().catch(() => undefined);
        }
      });
    }

    await page.goto(url, { waitUntil: opts.waitUntil, timeout: opts.timeout });

    if (opts.waitForNavigation) {
      await page.waitForNavigation({ timeout: opts.navigationTimeout }).catch(() => undefined);
    }

    const pageTitle = await page.title();
    const html = await page.content();
    let content: string;

    if (opts.returnHtml && !opts.extractContent) {
      content = html;
    } else if (opts.extractContent) {
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      if (article) {
        content = opts.returnHtml ? article.content : turndown.turndown(article.content);
      } else {
        content = opts.returnHtml ? html : turndown.turndown(html);
      }
    } else {
      content = turndown.turndown(html);
    }

    if (opts.maxLength && content.length > opts.maxLength) {
      content = content.slice(0, opts.maxLength) + "\n\n[content truncated]";
    }

    return { url, content, title: pageTitle };
  } finally {
    await context.close().catch(() => undefined);
  }
}

export function registerHobSite(server: McpServer): void {
  server.registerTool(
    "hob_site",
    {
      title: "Hob Site",
      description: `Fetch the content of a single web page using a Playwright headless browser.

Args:
  - url (string): The URL to fetch. Required.
  - timeout (number): Page-load timeout in ms. Default 30000.
  - waitUntil: 'load' | 'domcontentloaded' | 'networkidle' | 'commit'. Default 'load'.
  - extractContent (boolean): Strip noise via Readability. Default true.
  - maxLength (number): Truncate output to this many characters.
  - returnHtml (boolean): Return HTML instead of Markdown. Default false.
  - waitForNavigation (boolean): Wait for a second navigation. Default false.
  - navigationTimeout (number): Timeout for extra navigation wait. Default 10000.
  - disableMedia (boolean): Block images/fonts/media. Default true.
  - debug (boolean): Show browser window. Default false.

Returns: Page content as Markdown (or HTML), prefixed with title and URL.`,
      inputSchema: z.object({
        url: z.string().url().describe("The URL of the web page to fetch"),
        ...FetchParamsBase,
      }),
      annotations: {
        readOnlyHint: true, destructiveHint: false,
        idempotentHint: true, openWorldHint: true,
      },
    },
    async ({ url, timeout, waitUntil, extractContent, maxLength, returnHtml,
             waitForNavigation, navigationTimeout, disableMedia, debug }) => {
      try {
        const result = await fetchOne(url, { timeout, waitUntil, extractContent,
          maxLength, returnHtml, waitForNavigation, navigationTimeout, disableMedia, debug });
        const text = `# ${result.title}\n\nURL: ${result.url}\n\n---\n\n${result.content}`;
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error fetching ${url}: ${message}` }], isError: true };
      }
    }
  );
}

export function registerHobSites(server: McpServer): void {
  server.registerTool(
    "hob_sites",
    {
      title: "Hob Sites",
      description: `Fetch multiple web pages in parallel. Same as hob_site but accepts an array of URLs.

Args:
  - urls (string[]): URLs to fetch in parallel. Required.
  - (all other parameters identical to hob_site)

Returns: Combined content from all pages, separated by horizontal rules.`,
      inputSchema: z.object({
        urls: z.array(z.string().url()).min(1).describe("Array of URLs to fetch in parallel"),
        ...FetchParamsBase,
      }),
      annotations: {
        readOnlyHint: true, destructiveHint: false,
        idempotentHint: true, openWorldHint: true,
      },
    },
    async ({ urls, timeout, waitUntil, extractContent, maxLength, returnHtml,
             waitForNavigation, navigationTimeout, disableMedia, debug }) => {
      const opts: FetchOptions = { timeout, waitUntil, extractContent, maxLength,
        returnHtml, waitForNavigation, navigationTimeout, disableMedia, debug };
      try {
        const settled = await Promise.allSettled(urls.map((url) => fetchOne(url, opts)));
        const sections = settled.map((r, i) => {
          const url = urls[i] ?? "(unknown)";
          if (r.status === "fulfilled") {
            return `# ${r.value.title}\n\nURL: ${url}\n\n---\n\n${r.value.content}`;
          }
          const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
          return `# Error\n\nURL: ${url}\n\nFailed to fetch: ${msg}`;
        });
        return { content: [{ type: "text", text: sections.join("\n\n\n---\n\n\n") }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Batch fetch error: ${message}` }], isError: true };
      }
    }
  );
}

export function registerBrowserInstall(server: McpServer): void {
  server.registerTool(
    "browser_install",
    {
      title: "Browser Install",
      description: `Install the Playwright Chromium browser binary required by hob_site, hob_sites, and hob_search.

Run this if you see "Executable doesn't exist" or similar Playwright errors.
Safe to run at any time — skips installation if Chromium is already present unless force=true.

Args:
  - withDeps (boolean): Install system-level Chromium dependencies (Linux only). Default false.
  - force (boolean): Reinstall even if Chromium is already present. Default false.

Returns: Confirmation message or install output.`,
      inputSchema: z.object({
        withDeps: z.boolean().default(false)
          .describe("Install system dependencies (Linux only, may require sudo)"),
        force: z.boolean().default(false)
          .describe("Force reinstall even if Chromium is already present"),
      }),
      annotations: {
        readOnlyHint: false, destructiveHint: false,
        idempotentHint: false, openWorldHint: false,
      },
    },
    async ({ withDeps, force }) => {
      try {
        const args = ["playwright", "install", "chromium"];
        if (withDeps) args.push("--with-deps");
        if (force) args.push("--force");
        const output = execSync(`npx ${args.join(" ")}`, { encoding: "utf-8", timeout: 120_000 });
        return { content: [{ type: "text", text: `Browser installed successfully.\n\n${output}` }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Browser install failed: ${message}` }], isError: true };
      }
    }
  );
}
