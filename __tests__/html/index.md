# HTML / XML Surface

LLM orientation: this directory tests Brevity's HTML-like and XML-like surface
forms in the browser target.

## Tested Areas

- Element parsing and tags.
- Attributes and attribute validation.
- Dependency-injection spread into element/browser contexts.
- Reactive elements.
- `onclick` handling.
- Text interpolation.

## LLM Rules

- Treat this area as actively evolving.
- Prefer examples from `html/*.browser.test.js` and `xml/*.test.js`.
- Do not infer broad web-framework behavior from a single element test.
- Mention browser target constraints when describing runtime behavior.
