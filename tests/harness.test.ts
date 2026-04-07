/**
 * Harness Tests — hackernews
 *
 * Guards against regressions found during install simulation.
 * No browser, no network — runs in milliseconds.
 *
 * Lessons encoded here:
 *   - package.json must include "files" → dist or new users get source-only packages
 *   - repository.url required for npm provenance publishing
 *   - prepublishOnly ensures build runs before every publish
 */
import { describe, it, expect } from "vitest";
import adapter from "../src/index.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, "../package.json"), "utf8"));

// ── package.json structural guards ────────────────────────────────────────────
// These prevent the "published without dist" class of bug.

describe("package.json harness guards", () => {
  it('has "files" field containing "dist"', () => {
    expect(pkg.files, 'Missing "files" in package.json — dist/ will be excluded from npm publish').toBeDefined();
    expect(pkg.files).toContain("dist");
  });

  it("has repository.url — required for npm provenance publishing", () => {
    expect(pkg.repository?.url, 'Missing repository.url — npm provenance will reject the publish').toBeTruthy();
    expect(pkg.repository.url).toContain("github.com");
  });

  it("has prepublishOnly script — ensures build runs before every publish", () => {
    expect(pkg.scripts?.prepublishOnly, 'Missing prepublishOnly — packages may publish without compiling').toBeTruthy();
  });
});

// ── isLoggedIn contract (public adapter) ──────────────────────────────────────
// Public adapters hardcode isLoggedIn = true. Verify it accepts any page shape.

describe("isLoggedIn contract — public adapter", () => {
  it("returns true regardless of page state (public site, no auth required)", async () => {
    const emptyPage = { url: () => "about:blank" };
    expect(await adapter.isLoggedIn(emptyPage as never)).toBe(true);
  });
});

// ── Tool registry ─────────────────────────────────────────────────────────────

describe("tool registry", () => {
  it("tools() returns a non-empty array", () => {
    expect(adapter.tools().length).toBeGreaterThan(0);
  });

  it("every tool has a non-empty name and description", () => {
    for (const tool of adapter.tools()) {
      expect(tool.name.length, `tool missing name`).toBeGreaterThan(0);
      expect(tool.description?.length ?? 0, `"${tool.name}" missing description`).toBeGreaterThan(10);
    }
  });

  it("every tool has a handler", () => {
    for (const tool of adapter.tools()) {
      expect(typeof tool.handler, `"${tool.name}" missing handler`).toBe("function");
    }
  });
});
