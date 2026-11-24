---
status: done
created: 2026-11-22
---
# Retire the service doc text

The JSON document becomes the only published and accepted form.

- `extract(source).interface.service` is the JSON document.
- `remotes` no longer accepts doc text.
- Remove the doc text emitter and its parser as a published format. An interface written inline in Brevity source is still Brevity; it is parsed there and encoded with ticket 1.
- Convert every test that passes a doc text literal to a JSON literal.

Done when: no test or source file builds or parses service doc text, and the full suite is green.
