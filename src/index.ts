import { defineAdapter } from "@browserkit/core";
import { z } from "zod";
import type { Page } from "patchright";
import { SELECTORS } from "./selectors.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** "story" = regular submission, "job" = YC/HN job listing (no points, no author) */
type StoryType = "story" | "job";

interface Story {
  type: StoryType;
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

interface Comment {
  author: string;
  age: string;
  ageIso: string;
  text: string;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const countSchema = z.object({
  count: z.number().int().min(1).max(30).default(10).describe("Number of stories to return (1–30)"),
});

const commentsSchema = z.object({
  id: z
    .string()
    .describe(
      "HN story ID (numeric string, e.g. '43434343') or full item URL (https://news.ycombinator.com/item?id=...)"
    )
    .refine(
      (v) => /^\d+$/.test(v) || v.includes("item?id="),
      { message: "id must be a numeric story ID or a full item URL" }
    ),
  count: z.number().int().min(1).max(20).default(10).describe("Number of top-level comments to return"),
});

type CountInput = z.infer<typeof countSchema>;
type CommentsInput = z.infer<typeof commentsSchema>;

// ─── Shared scraping helpers ──────────────────────────────────────────────────

async function scrapeStories(page: Page, count: number): Promise<Story[]> {
  await page.waitForSelector(SELECTORS.storyRow, { timeout: 15_000 });

  // Each story spans two <tr>s: the title row (.athing) and the subtext row.
  // SELECTORS is passed in so this file is the single source of truth for CSS strings.
  const stories: Story[] = await page.evaluate(
    ({ sel, n }) => {
      const rows = Array.from(document.querySelectorAll(sel.storyRow)).slice(0, n);
      return rows.map((row) => {
        const subtext = row.nextElementSibling;
        const titleEl = row.querySelector(sel.titleLink) as HTMLAnchorElement | null;
        const domainEl = row.querySelector(sel.domain);
        const rankEl = row.querySelector(sel.rank);
        const scoreEl = subtext?.querySelector(sel.score);
        const authorEl = subtext?.querySelector(sel.author) as HTMLAnchorElement | null;
        // The ISO timestamp is on <span class="age" title="2026-...">; the link is the child <a>
        const ageSpanEl = subtext?.querySelector("span.age") as HTMLElement | null;
        const ageEl = ageSpanEl?.querySelector("a") as HTMLAnchorElement | null;
        const commentLinks = subtext?.querySelectorAll("a") ?? [];
        const lastLink = commentLinks[commentLinks.length - 1] as HTMLAnchorElement | undefined;

        const commentsText = lastLink?.textContent?.trim() ?? "";
        const commentsMatch = commentsText.match(/(\d+)\s+comment/);

        // Job listings have no .score element — use that to detect type.
        const isJob = scoreEl === null && authorEl === null;

        return {
          type: isJob ? "job" : "story",
          rank: parseInt(rankEl?.textContent?.replace(".", "") ?? "0", 10) || 0,
          title: titleEl?.textContent?.trim() ?? "",
          url: titleEl?.href ?? "",
          domain: domainEl?.textContent?.trim() ?? "",
          points: parseInt(scoreEl?.textContent?.replace(/\D+/g, "") ?? "0", 10) || 0,
          author: authorEl?.textContent?.trim() ?? "",
          age: ageEl?.textContent?.trim() ?? "",
          ageIso: (ageSpanEl?.title ?? "").split(" ")[0] ?? "",
          comments: commentsMatch ? parseInt(commentsMatch[1] ?? "0", 10) : 0,
          discussionUrl: ageEl?.href ?? "",
        };
      });
    },
    { sel: SELECTORS, n: count }
  );

  return stories.filter((s) => s.title.length > 0);
}

/**
 * Convert the inner HTML of a comment element to plain text, preserving links
 * as markdown: [link text](url). Strips all other tags.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_, href, text) => {
      const cleanText = text.replace(/<[^>]+>/g, "").trim();
      return cleanText ? `[${cleanText}](${href})` : href;
    })
    .replace(/<p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Feed tools (data-driven) ─────────────────────────────────────────────────

const FEED_TOOLS = [
  { name: "get_top",  path: "/",        description: "Get the top stories from the Hacker News front page" },
  { name: "get_new",  path: "/newest",  description: "Get the newest submissions on Hacker News" },
  { name: "get_ask",  path: "/ask",     description: "Get posts from HN's Ask page (includes Ask HN, Tell HN, and related posts)" },
  { name: "get_show", path: "/show",    description: "Get Show HN posts" },
] as const;

// ─── Adapter ──────────────────────────────────────────────────────────────────

export default defineAdapter({
  site: "hackernews",
  domain: "news.ycombinator.com",
  loginUrl: "https://news.ycombinator.com/login",
  selectors: SELECTORS,
  // No rate limit — public read-only site, no login required

  // HN is fully public — always return true so the framework never triggers handoff
  async isLoggedIn(_page: Page): Promise<boolean> {
    return true;
  },

  tools: () => [
    // ── Feed tools (get_top / get_new / get_ask / get_show) ───────────────────
    ...FEED_TOOLS.map(({ name, path, description }) => ({
      name,
      description,
      inputSchema: countSchema,
      async handler(page: Page, input: unknown): Promise<{ content: [{ type: "text"; text: string }] }> {
        const { count } = countSchema.parse(input) satisfies CountInput;
        await page.goto(`https://news.ycombinator.com${path}`, {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });
        const stories = await scrapeStories(page, count);
        return { content: [{ type: "text" as const, text: JSON.stringify(stories, null, 2) }] };
      },
    })),

    // ── get_comments ─────────────────────────────────────────────────────────
    {
      name: "get_comments",
      description: "Get top-level comments for a Hacker News story by its ID or URL",
      inputSchema: commentsSchema,
      async handler(page: Page, input: unknown): Promise<{ content: [{ type: "text"; text: string }]; isError?: boolean }> {
        const { id, count } = commentsSchema.parse(input) satisfies CommentsInput;

        const storyId = id.includes("item?id=")
          ? new URL(id).searchParams.get("id") ?? ""
          : id; // already validated as /^\d+$/ by schema

        if (!storyId || !/^\d+$/.test(storyId)) {
          return {
            content: [{ type: "text" as const, text: `Invalid story ID: "${id}". Provide a numeric ID or a full item URL.` }],
            isError: true,
          };
        }

        await page.goto(`https://news.ycombinator.com/item?id=${storyId}`, {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });

        // Detect "No such item." — HN returns a bare page with this text for unknown IDs
        const bodyText = await page.evaluate(() => document.body.innerText.trim());
        if (bodyText === "No such item.") {
          return {
            content: [{ type: "text" as const, text: `Story "${storyId}" not found on Hacker News.` }],
            isError: true,
          };
        }

        // Wait for comment rows to be present; job posts and 0-comment stories won't have them.
        const hasComments = await page.locator(".comtr").count();
        if (hasComments === 0) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify([], null, 2) }],
          };
        }

        const rawComments = await page.evaluate(
          ({ sel, n }) => {
            // Top-level comments have indent img width === 0
            const rows = Array.from(document.querySelectorAll(".comtr")).filter((row) => {
              const indent = row.querySelector(sel.commentIndent) as HTMLImageElement | null;
              return (indent?.width ?? 0) === 0;
            });
            return rows.slice(0, n).map((row) => {
              const textEl = row.querySelector(sel.comment);
              const authorEl = row.querySelector(sel.commentAuthor) as HTMLAnchorElement | null;
              // The ISO timestamp is on <span class="age" title="2026-...">
              const ageSpanEl = row.querySelector("span.age") as HTMLElement | null;
              const ageEl = ageSpanEl?.querySelector("a") as HTMLAnchorElement | null;
              return {
                author: authorEl?.textContent?.trim() ?? "[deleted]",
                age: ageEl?.textContent?.trim() ?? "",
                ageIso: (ageSpanEl?.title ?? "").split(" ")[0] ?? "",
                // Return innerHTML so we can convert links to markdown in Node.js
                html: textEl?.innerHTML ?? "[deleted]",
              };
            });
          },
          { sel: SELECTORS, n: count }
        );

        const comments: Comment[] = rawComments.map(({ author, age, ageIso, html }) => {
          const text = htmlToText(html);
          const truncated = text.length > 500;
          return {
            author,
            age,
            ageIso,
            text: truncated ? text.slice(0, 500) + "…" : text,
          };
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(comments, null, 2) }],
        };
      },
    },
  ],
});
