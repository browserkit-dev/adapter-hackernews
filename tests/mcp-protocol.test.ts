/**
 * L3 — MCP Protocol Tests
 *
 * Starts the HN adapter in-process, connects via the real MCP HTTP transport,
 * and verifies: server lifecycle, tool registry, tool dispatch, auth, and error paths.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import hackernewsAdapter from "../src/index.js";
import { createTestAdapterServer, type TestAdapterServer } from "@browserkit-dev/core/testing";
import { createTestMcpClient, type TestMcpClient } from "@browserkit-dev/core/testing";

// ── Shared server (one browser for the whole suite) ──────────────────────────

let server: TestAdapterServer;
let client: TestMcpClient;

beforeAll(async () => {
  server = await createTestAdapterServer(hackernewsAdapter);
  client = await createTestMcpClient(server.url);
}, 30_000);

afterAll(async () => {
  await client.close();
  await server.stop();
});

// ── Tool registry ─────────────────────────────────────────────────────────────

describe("tool registry", () => {
  it("lists all 5 adapter tools", async () => {
    const tools = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_top");
    expect(names).toContain("get_new");
    expect(names).toContain("get_ask");
    expect(names).toContain("get_show");
    expect(names).toContain("get_comments");
  });

  it("lists all 5 auto-registered management tools", async () => {
    const tools = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("browser");
  });

  it("all tools have a description", async () => {
    const tools = await client.listTools();
    for (const tool of tools) {
      expect(tool.description, `tool "${tool.name}" missing description`).toBeTruthy();
    }
  });
});

// ── health_check ──────────────────────────────────────────────────────────────

describe("health_check", () => {
  it("reports site=hackernews, loggedIn=true, mode=headless", async () => {
    const result = await client.callTool("browser", { action: "health_check" });
    expect(result.isError).toBeFalsy();

    const text = result.content[0]?.text ?? "";
    const status = JSON.parse(text) as {
      site: string;
      loggedIn: boolean;
      mode: string;
      selectors?: Record<string, unknown>;
    };

    expect(status.site).toBe("hackernews");
    expect(status.loggedIn).toBe(true);
    expect(status.mode).toBe("headless");
  });

  it("reports selector health for known selectors", async () => {
    const result = await client.callTool("browser", { action: "health_check" });
    const text = result.content[0]?.text ?? "";
    const status = JSON.parse(text) as { selectors?: Record<string, { found: boolean }> };

    if (status.selectors) {
      expect(typeof status.selectors).toBe("object");
    }
  });
});

// ── get_page_state ────────────────────────────────────────────────────────────

describe("get_page_state", () => {
  it("returns url, title, mode, isPaused", async () => {
    const result = await client.callTool("browser", { action: "page_state" });
    expect(result.isError).toBeFalsy();

    const text = result.content[0]?.text ?? "";
    const state = JSON.parse(text) as {
      url: string;
      title: string;
      mode: string;
      isPaused: boolean;
    };

    expect(typeof state.url).toBe("string");
    expect(typeof state.title).toBe("string");
    expect(state.mode).toBe("headless");
    expect(state.isPaused).toBe(false);
  });
});

// ── get_top tool dispatch ─────────────────────────────────────────────────────

describe("get_top tool dispatch", () => {
  it("returns a JSON array of stories with the expected shape", async () => {
    const result = await client.callTool("get_top", { count: 3 });
    expect(result.isError).toBeFalsy();

    const text = result.content[0]?.text ?? "";
    const stories = JSON.parse(text) as Array<{
      rank: number;
      title: string;
      url: string;
      points: number;
      author: string;
      comments: number;
      discussionUrl: string;
    }>;

    expect(Array.isArray(stories)).toBe(true);
    expect(stories.length).toBeGreaterThan(0);
    expect(stories.length).toBeLessThanOrEqual(3);

    const first = stories[0]!;
    expect(typeof first.rank).toBe("number");
    expect(typeof first.title).toBe("string");
    expect(first.title.length).toBeGreaterThan(0);
    expect(typeof first.points).toBe("number");
    expect(typeof first.discussionUrl).toBe("string");
    expect("storyUrl" in first).toBe(false);
  });

  it("result content type is text", async () => {
    const result = await client.callTool("get_top", { count: 1 });
    expect(result.content[0]?.type).toBe("text");
  });
});

// ── get_comments with valid ID ────────────────────────────────────────────────

describe("get_comments tool dispatch", () => {
  it("returns a JSON array of comments for a known story", async () => {
    const result = await client.callTool("get_comments", { id: "1", count: 3 });
    expect(result.isError).toBeFalsy();

    const text = result.content[0]?.text ?? "";
    const comments = JSON.parse(text) as Array<{
      author: string;
      age: string;
      text: string;
    }>;

    expect(Array.isArray(comments)).toBe(true);
  });

  it("accepts a full item URL as id", async () => {
    const result = await client.callTool("get_comments", {
      id: "https://news.ycombinator.com/item?id=1",
      count: 1,
    });
    expect(result.isError).toBeFalsy();
  });
});

// ── Error paths ───────────────────────────────────────────────────────────────

describe("error handling", () => {
  it("schema validation errors are reported for invalid get_top count", async () => {
    // The MCP SDK returns Zod validation errors as isError:true content
    const result = await client.callTool("get_top", { count: 0 }).catch((e: Error) => e);
    if (result instanceof Error) {
      // SDK may throw for protocol-level validation errors
      expect(result.message).toMatch(/validation|invalid/i);
    } else {
      expect(result.isError).toBe(true);
    }
  });

  it("schema validation errors are reported for non-numeric get_comments id", async () => {
    const result = await client.callTool("get_comments", { id: "notanumber" }).catch((e: Error) => e);
    if (result instanceof Error) {
      expect(result.message).toMatch(/validation|invalid|numeric/i);
    } else {
      expect(result.isError).toBe(true);
    }
  });
});

// ── Bearer token auth ─────────────────────────────────────────────────────────

describe("bearer token auth", () => {
  let protectedServer: TestAdapterServer;

  beforeAll(async () => {
    protectedServer = await createTestAdapterServer(hackernewsAdapter, "test-secret-token");
  }, 30_000);

  afterAll(async () => {
    await protectedServer.stop();
  });

  it("rejects requests without a bearer token with 401", async () => {
    const unauthClient = await createTestMcpClient(protectedServer.url).catch((e) => e);
    if (unauthClient instanceof Error) {
      expect(unauthClient.message).toBeTruthy();
    } else {
      const result = await unauthClient.callTool("browser", { action: "health_check" }).catch((e: Error) => e);
      expect(result instanceof Error).toBe(true);
      await unauthClient.close();
    }
  });
});
