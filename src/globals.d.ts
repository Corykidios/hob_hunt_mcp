// Local type shims — covers what @types/node provides for our use cases,
// plus stub declarations for modules whose @types packages won't install
// due to playwright-extra's dependency tree.

/// <reference lib="es2022" />

// Module stubs
declare module "jsdom" {
  export class JSDOM {
    constructor(html: string, options?: { url?: string; [key: string]: unknown });
    readonly window: { document: Document };
  }
}

declare module "turndown" {
  interface Options {
    headingStyle?: "setext" | "atx";
    codeBlockStyle?: "indented" | "fenced";
    [key: string]: unknown;
  }
  export default class TurndownService {
    constructor(options?: Options);
    turndown(html: string): string;
  }
}

declare module "child_process" {
  interface ExecSyncOptions {
    encoding?: string;
    timeout?: number;
    maxBuffer?: number;
    cwd?: string;
  }
  function execSync(command: string, options?: ExecSyncOptions & { encoding: "utf-8" | "utf8" }): string;
  function execSync(command: string, options?: ExecSyncOptions): Buffer;
}

declare namespace NodeJS {
  interface ProcessEnv {
    [key: string]: string | undefined;
  }
  interface Process {
    argv: string[];
    env: ProcessEnv;
    exit(code?: number): never;
    on(event: string, listener: (...args: unknown[]) => void): this;
    stderr: { write(s: string): boolean };
  }
}

declare var process: NodeJS.Process;
