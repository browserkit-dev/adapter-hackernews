import { describe, it, expect } from "vitest";
import adapter from "../src/index.js";

describe("HackerNews adapter", () => {
  it("has correct metadata", () => {
    expect(adapter.site).toBe("hackernews");
    expect(adapter.domain).toBe("news.ycombinator.com");
    expect(adapter.loginUrl).toContain("ycombinator.com");
  });

  it("is always considered logged in (public site)", async () => {
    const loggedIn = await adapter.isLoggedIn({} as never);
    expect(loggedIn).toBe(true);
  });

  it("exposes expected tools", () => {
    const names = adapter.tools().map((t) => t.name);
    expect(names).toContain("get_top");
    expect(names).toContain("get_new");
    expect(names).toContain("get_ask");
    expect(names).toContain("get_show");
    expect(names).toContain("get_comments");
  });

  it("exposes selectors for health_check reporting", () => {
    expect(adapter.selectors).toBeDefined();
    expect(typeof adapter.selectors?.storyRow).toBe("string");
    expect(typeof adapter.selectors?.titleLink).toBe("string");
  });

  // ── get_top schema ─────────────────────────────────────────────────────────

  it("get_top schema accepts valid count", () => {
    const tool = adapter.tools().find((t) => t.name === "get_top")!;
    expect(tool.inputSchema.safeParse({ count: 5 }).success).toBe(true);
    expect(tool.inputSchema.safeParse({ count: 1 }).success).toBe(true);
    expect(tool.inputSchema.safeParse({ count: 30 }).success).toBe(true);
  });

  it("get_top schema rejects count=0 (below min)", () => {
    const tool = adapter.tools().find((t) => t.name === "get_top")!;
    expect(tool.inputSchema.safeParse({ count: 0 }).success).toBe(false);
  });

  it("get_top schema rejects count=31 (above max)", () => {
    const tool = adapter.tools().find((t) => t.name === "get_top")!;
    expect(tool.inputSchema.safeParse({ count: 31 }).success).toBe(false);
  });

  // ── get_comments schema ────────────────────────────────────────────────────

  it("get_comments requires id", () => {
    const tool = adapter.tools().find((t) => t.name === "get_comments")!;
    expect(tool.inputSchema.safeParse({}).success).toBe(false);
  });

  it("get_comments accepts a bare numeric ID", () => {
    const tool = adapter.tools().find((t) => t.name === "get_comments")!;
    expect(tool.inputSchema.safeParse({ id: "43434343" }).success).toBe(true);
  });

  it("get_comments accepts a full item URL", () => {
    const tool = adapter.tools().find((t) => t.name === "get_comments")!;
    expect(
      tool.inputSchema.safeParse({ id: "https://news.ycombinator.com/item?id=43434343" }).success
    ).toBe(true);
  });

  it("get_comments rejects a bare non-numeric string", () => {
    const tool = adapter.tools().find((t) => t.name === "get_comments")!;
    const result = tool.inputSchema.safeParse({ id: "notanumber" });
    expect(result.success).toBe(false);
  });

  it("get_comments rejects an empty string", () => {
    const tool = adapter.tools().find((t) => t.name === "get_comments")!;
    expect(tool.inputSchema.safeParse({ id: "" }).success).toBe(false);
  });

  it("get_comments rejects a mixed alphanumeric string", () => {
    const tool = adapter.tools().find((t) => t.name === "get_comments")!;
    expect(tool.inputSchema.safeParse({ id: "abc123" }).success).toBe(false);
  });

  it("get_comments schema accepts count", () => {
    const tool = adapter.tools().find((t) => t.name === "get_comments")!;
    expect(tool.inputSchema.safeParse({ id: "43434343", count: 5 }).success).toBe(true);
  });

  it("get_comments schema rejects count=0", () => {
    const tool = adapter.tools().find((t) => t.name === "get_comments")!;
    expect(tool.inputSchema.safeParse({ id: "43434343", count: 0 }).success).toBe(false);
  });

  // ── Story shape ────────────────────────────────────────────────────────────

  it("Story type uses discussionUrl not storyUrl", () => {
    const tool = adapter.tools().find((t) => t.name === "get_top")!;
    expect(tool).toBeDefined();
    const descStr = JSON.stringify(tool.description ?? "");
    expect(descStr).not.toContain("storyUrl");
  });

  it("get_ask description reflects mixed content (not exclusively Ask HN)", () => {
    const tool = adapter.tools().find((t) => t.name === "get_ask")!;
    expect(tool.description).toContain("Ask page");
  });
});
