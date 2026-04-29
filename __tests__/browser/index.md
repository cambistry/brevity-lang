# Browser Target

LLM orientation: these tests cover the browser host/runtime behavior. They are
not a separate language; they exercise Brevity actors compiled for a browser
environment.

## Tested Areas

- Script and script-file loading.
- Closure-as-child/browser subscription behavior.
- DOM subscriptions to child actors.
- Factory-style end-to-end browser workflows.
- Nested templates.
- XML/text interpolation in browser-hosted output.

## LLM Rules

- Treat the browser target as host/runtime integration around compiled actors.
- Do not claim all DOM/platform APIs are complete.
- Keep examples close to existing tests before describing browser features as
  stable public syntax.
- For syntax-level element behavior, also inspect [HTML / XML Surface](../html/index.md).
