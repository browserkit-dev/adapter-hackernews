# @browserkit/adapter-hackernews

[Hacker News](https://news.ycombinator.com) adapter for [browserkit](https://github.com/browserkit-dev/browserkit) — exposes HN as MCP tools over a persistent headless browser session.

## Tools

| Tool | Input | Description |
|---|---|---|
| `get_top` | `count: 1–30` | Front page stories |
| `get_new` | `count: 1–30` | Newest submissions |
| `get_ask` | `count: 1–30` | Ask HN posts |
| `get_show` | `count: 1–30` | Show HN posts |
| `get_comments` | `id: numeric or URL`, `count: 1–20` | Top-level comments for a story |

Plus 5 auto-registered management tools from the framework: `health_check`, `set_mode`, `take_screenshot`, `get_page_state`, `navigate`.

## Usage

```js
// browserkit.config.js
import { defineConfig } from "@browserkit/core";

export default defineConfig({
  adapters: {
    "@browserkit/adapter-hackernews": { port: 3847 },
  },
});
```

```bash
npx @browserkit/core start
```

Connect any MCP client to `http://127.0.0.1:3847/mcp`.

## Tests

```bash
pnpm test                # unit + MCP protocol + reliability (61 tests)
pnpm test:integration    # live browser scraping against real HN
```
