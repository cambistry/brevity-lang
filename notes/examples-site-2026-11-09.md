# Examples site — 2026-11-09

A multi-page examples site for Brevity, hosted from the repo (and later GitHub Pages). It shows
working Brevity webpages next to their source. Dogfooding details and the language holes the
viewer found are in `session-2026-11-07-examples-viewer.md`.

## Layout

- `docs/serve.js`: local dev server. `node docs/serve.js [port]` → `http://127.0.0.1:8000/site/`.
- `docs/site/`: the site root.
  - `index.html`, `viewer.bv`, `viewer.css`: the viewer, written in Brevity.
  - `hello/`: the first example (template + click counter).
- `src/codegen/browser/static_server.js`: static file serving shared by the dev server and the
  browser test harness (`harness.js`), so the site and the tests serve files the same way.

## No build step

`brevity.js` isn't a bundle. It imports the compiler (`lexer.js`, `parser.js`, …) from `src/` as
plain ESM and compiles `.bv` in the page. So the local site needs no build at all: the server
serves `docs/` as the root and maps `/src/` to the repo's `src/`, with caching off.

The original plan (explicit local builds of `brevity.js` / `runtime.js`, gitignored, maybe an
auto-rebuild when stale) turned out to be unnecessary locally. It only returns as a publish step
for Pages.

The server is Node, not Python: the repo already requires Node, and sharing the static server
with the harness removes a "works in tests, broken on the site" gap.

## GitHub Pages (planned)

Pages can serve `docs/` from a branch, but `/src/` isn't under `docs/`, so the site would load no
compiler:

- **Deploy from Actions, not the branch.** A workflow copies `src/` into the published output
  alongside `docs/site/`.
- **Make the `/src/…` links relative.** Project pages live under `/brevity-lang/`, so root-relative
  paths break. Every URL in the site should be relative.
- **Add `.nojekyll`,** or Jekyll silently drops `_`-prefixed paths.
- **Decide about `docs/*.md`.** `docs/` already holds the Markdown docs, and Pages would publish
  them too (rendered by Jekyll unless disabled). The site lives in `docs/site/` to keep the two
  apart for now.
- All of the user's repos share the `username.github.io` origin. That matters for storage and
  SharedWorker names.

## The viewer

A split screen: an accordion of an example's source files on the left (`<details>` /
`<summary>` / `<pre>`), the example running in an `<iframe>` on the right. On a phone, the panes
stack.

- **The iframe keeps each example standalone.** It also works opened directly, the tests can load
  it the same way, and its runtime and DOM stay separate from the viewer's.
- **The source shown is fetched from the same files the iframe runs.** Nothing is copied, so it
  can't drift.
- **Written in Brevity, deliberately.** The viewer is the rough surface to design against, not an
  abstract set of cases. Where it hurts, it shows the holes.

Today it's fixed to the `hello` example with three hand-written panels (see the session note for
why: no fetch, no list → children, no query string, template closures can't see function locals).

### Direction

- **Choose the example by query string** (`?ex=hello`). That needs location access.
- **Find the files** from the example's `index.html` (`src` / `href`), with `index.html` itself
  first. Later, follow `.bv` imports using Brevity's own parser, which is already loaded in the
  page.
- **Generate the panels from the file list.** That needs list → children rendering.
- **`.bv` syntax highlighting.** Plain `<pre>` for now.
- **A playground:** an editable left pane that reloads the right one. The viewer and the iframe
  would then talk over `postMessage`, the same boundary question as communication between pages.
- **Each example as a smoke test:** Playwright can load every page.

## Not committed

- `docs/site/scope-test/`: the scoped-`<style>` experiment (`scoped-styles-2026-11-09.md`).
  Keep as an example, or delete.
