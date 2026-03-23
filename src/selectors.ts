/**
 * HackerNews DOM selectors — confirmed from live page snapshot.
 * HN uses a classic table layout with stable class names that have not changed in years.
 */
export const SELECTORS = {
  // Each story row (contains rank, upvote, title)
  storyRow: "tr.athing",

  // Title link inside a story row
  titleLink: ".titleline > a",

  // Domain badge next to title
  domain: ".titleline .sitestr",

  // Subtext row (points, author, time, comments) — sibling of storyRow
  subtext: ".subtext",

  // Score within subtext
  score: ".score",

  // Author within subtext
  author: "a.hnuser",

  // "N hours ago" link within subtext
  age: "span.age a",

  // Comments link — last <a> in subtext
  commentsLink: ".subtext a:last-child",

  // Story rank number
  rank: ".rank",

  // Comment text on a story page
  comment: ".commtext",

  // Comment author
  commentAuthor: ".hnuser",

  // Indent image used to determine comment nesting depth (width=0 means top-level)
  commentIndent: ".ind img",
} as const;
