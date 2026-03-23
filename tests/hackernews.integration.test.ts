/**
 * L2 — Scraping Integration Tests
 *
 * Runs a real headless browser against live Hacker News.
 * These tests require network access and are NOT run in CI by default.
 * Run with: pnpm --filter @browserkit/adapter-hackernews test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import hackernewsAdapter from "../src/index.js";
import { createTestAdapterServer, type TestAdapterServer } from "@browserkit/core/testing";
import { createTestMcpClient, type TestMcpClient } from "@browserkit/core/testing";

// ── Shared server (one browser for the whole integration suite) ───────────────

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

// ── Story shape assertions ────────────────────────────────────────────────────

interface Story {
  type: "story" | "job";
  rank: number;
  title: string;
  url: string;
  domain: string;
  points: number;
  author: string;
  age: string;
  ageIso: string;
  comments: number;
  discussionUrl: string;
}

function assertStoryShape(story: Story, index: number): void {
  expect(story.rank, `story[${index}].rank`).toBeGreaterThan(0);
  expect(story.title, `story[${index}].title`).toBeTruthy();
  expect(typeof story.url, `story[${index}].url`).toBe("string");
  expect(typeof story.points, `story[${index}].points`).toBe("number");
  expect(typeof story.comments, `story[${index}].comments`).toBe("number");
  expect(["story", "job"], `story[${index}].type`).toContain(story.type);
  expect(typeof story.ageIso, `story[${index}].ageIso`).toBe("string");
  // job postings have no discussionUrl (ageEl is absent)
  if (story.type === "story") {
    expect(story.discussionUrl, `story[${index}].discussionUrl`).toContain("item?id=");
  }
  // storyUrl must not exist — it was renamed to discussionUrl
  expect("storyUrl" in story, `story[${index}] must not have storyUrl`).toBe(false);
}

// ── get_top ───────────────────────────────────────────────────────────────────

describe("get_top (live HN)", () => {
  it("returns 5 top stories with valid shape", async () => {
    const result = await client.callTool("get_top", { count: 5 });
    expect(result.isError).toBeFalsy();

    const stories = JSON.parse(result.content[0]?.text ?? "[]") as Story[];
    expect(stories.length).toBeGreaterThanOrEqual(1);
    expect(stories.length).toBeLessThanOrEqual(5);
    stories.forEach((s, i) => assertStoryShape(s, i));
  });

  it("stories have sequential ranks starting at 1", async () => {
    const result = await client.callTool("get_top", { count: 5 });
    const stories = JSON.parse(result.content[0]?.text ?? "[]") as Story[];
    stories.forEach((s, i) => {
      expect(s.rank).toBe(i + 1);
    });
  });

  it("top stories have positive point scores", async () => {
    const result = await client.callTool("get_top", { count: 5 });
    const stories = JSON.parse(result.content[0]?.text ?? "[]") as Story[];
    const withPoints = stories.filter((s) => s.points > 0);
    // At least some top stories should have points
    expect(withPoints.length).toBeGreaterThan(0);
  });
});

// ── get_new ───────────────────────────────────────────────────────────────────

describe("get_new (live HN)", () => {
  it("returns newest stories with valid shape", async () => {
    const result = await client.callTool("get_new", { count: 5 });
    expect(result.isError).toBeFalsy();

    const stories = JSON.parse(result.content[0]?.text ?? "[]") as Story[];
    expect(stories.length).toBeGreaterThanOrEqual(1);
    stories.forEach((s, i) => assertStoryShape(s, i));
  });

  it("newest stories differ from top stories (different ordering)", async () => {
    const [topResult, newResult] = await Promise.all([
      client.callTool("get_top", { count: 5 }),
      client.callTool("get_new", { count: 5 }),
    ]);
    const topTitles = (JSON.parse(topResult.content[0]?.text ?? "[]") as Story[]).map(
      (s) => s.title
    );
    const newTitles = (JSON.parse(newResult.content[0]?.text ?? "[]") as Story[]).map(
      (s) => s.title
    );
    // Very unlikely to be identical — at minimum the order should differ
    const sameOrder = topTitles.join("|") === newTitles.join("|");
    expect(sameOrder).toBe(false);
  });
});

// ── get_ask ───────────────────────────────────────────────────────────────────

describe("get_ask (live HN)", () => {
  it("returns Ask HN posts — the page includes Ask HN and Tell HN posts", async () => {
    const result = await client.callTool("get_ask", { count: 5 });
    expect(result.isError).toBeFalsy();

    const stories = JSON.parse(result.content[0]?.text ?? "[]") as Story[];
    expect(stories.length).toBeGreaterThanOrEqual(1);

    // HN's /ask page includes Ask HN, Tell HN, and related posts — not exclusively "Ask HN:"
    const askOrTellPosts = stories.filter(
      (s) => s.title.startsWith("Ask HN") || s.title.startsWith("Tell HN")
    );
    expect(askOrTellPosts.length).toBeGreaterThan(0);
  });
});

// ── get_show ──────────────────────────────────────────────────────────────────

describe("get_show (live HN)", () => {
  it("returns Show HN posts", async () => {
    const result = await client.callTool("get_show", { count: 5 });
    expect(result.isError).toBeFalsy();

    const stories = JSON.parse(result.content[0]?.text ?? "[]") as Story[];
    expect(stories.length).toBeGreaterThanOrEqual(1);

    const showPosts = stories.filter((s) => s.title.startsWith("Show HN"));
    expect(showPosts.length).toBeGreaterThan(0);
  });
});

// ── get_comments ──────────────────────────────────────────────────────────────

describe("get_comments (live HN)", () => {
  interface Comment {
    author: string;
    age: string;
    ageIso: string;
    text: string;
  }

  it("returns comments for a real story via numeric ID", async () => {
    // Get a real story ID from the front page first
    const topResult = await client.callTool("get_top", { count: 1 });
    const topStories = JSON.parse(topResult.content[0]?.text ?? "[]") as Story[];
    const storyId = topStories[0]?.discussionUrl.match(/id=(\d+)/)?.[1];
    expect(storyId).toBeTruthy();

    const result = await client.callTool("get_comments", { id: storyId!, count: 5 });
    expect(result.isError).toBeFalsy();

    const comments = JSON.parse(result.content[0]?.text ?? "[]") as Comment[];
    expect(Array.isArray(comments)).toBe(true);
    for (const comment of comments) {
      expect(typeof comment.author).toBe("string");
      expect(typeof comment.ageIso).toBe("string");
      expect(comment.text.length).toBeLessThanOrEqual(501);
    }
  });

  it("returns comments via full item URL", async () => {
    const result = await client.callTool("get_comments", {
      id: "https://news.ycombinator.com/item?id=1",
      count: 3,
    });
    expect(result.isError).toBeFalsy();
    const comments = JSON.parse(result.content[0]?.text ?? "[]") as Comment[];
    expect(Array.isArray(comments)).toBe(true);
  });

  it("returns isError=true for a non-existent story ID", async () => {
    const result = await client.callTool("get_comments", { id: "99999999999" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("not found");
  });

  it("returns empty array for a job posting (no comments section)", async () => {
    // Job postings on HN have no comment section
    // The GoGoGrandparent posting ID we saw in testing — but IDs change, so we
    // verify the shape: if a story has type:"job", get_comments returns [].
    const topResult = await client.callTool("get_top", { count: 30 });
    const stories = JSON.parse(topResult.content[0]?.text ?? "[]") as Story[];
    const job = stories.find((s) => s.type === "job");
    if (!job) return; // no job listing on front page right now — skip
    const storyId = job.discussionUrl.match(/id=(\d+)/)?.[1] ?? job.url.match(/\d+$/)?.[0];
    if (!storyId) return;
    const result = await client.callTool("get_comments", { id: storyId });
    expect(result.isError).toBeFalsy();
    const comments = JSON.parse(result.content[0]?.text ?? "[]") as Comment[];
    expect(Array.isArray(comments)).toBe(true);
  });

  it("truncated comments have ellipsis suffix", async () => {
    const topResult = await client.callTool("get_top", { count: 3 });
    const topStories = JSON.parse(topResult.content[0]?.text ?? "[]") as Story[];

    for (const story of topStories) {
      const storyId = story.discussionUrl.match(/id=(\d+)/)?.[1];
      if (!storyId) continue;
      const result = await client.callTool("get_comments", { id: storyId, count: 10 });
      const comments = JSON.parse(result.content[0]?.text ?? "[]") as Comment[];
      for (const comment of comments) {
        if (comment.text.length === 501) {
          expect(comment.text.endsWith("…")).toBe(true);
        }
      }
    }
  });
});

// ── Selector health (validates our selectors still work on live HN) ───────────

describe("selector health (live HN)", () => {
  it("health_check reports all key selectors as found after navigating to HN", async () => {
    // First navigate so the browser is on HN
    await client.callTool("navigate", { url: "https://news.ycombinator.com/" });

    const result = await client.callTool("health_check");
    const status = JSON.parse(result.content[0]?.text ?? "{}") as {
      selectors?: Record<string, { found: boolean; count: number }>;
    };

    if (status.selectors) {
      expect(status.selectors["storyRow"]?.found).toBe(true);
      expect((status.selectors["storyRow"]?.count ?? 0)).toBeGreaterThan(0);
      expect(status.selectors["titleLink"]?.found).toBe(true);
    }
  });
});
