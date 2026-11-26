---
created: 2026-11-19
---
# Parser invariant — every token is consumed into the tree or reported

Problem

Several parser paths advanced past tokens without using them, so bad input compiled silently: the file-level loop's `else { consume(); }`, a braced body's `} : Type` parsed and discarded, a top-level `**` swallowed. Each was found by accident. Nothing checks the property directly.

Proposal

A debug-mode invariant, on in the test suite: after a successful parse, every token index from the lexer is accounted for — either covered by an AST node's source span, or a structural token the grammar consumes by definition (NEWLINE, BLOCK_SEP, DIVIDER, brackets, separators, `=`/`->` openers, keywords that open a form). A token that is neither is a parser bug: fail with the token, its index, and the enclosing construct.

Needs

- Source spans on AST nodes (at least start/end token index). Tokens carry no position today (src/lexer.js), so this likely starts with `line`/index on tokens — shared with the name-resolution ticket's line-number dependency.
- A list of "consumed by definition" token types, kept next to the grammar.

Scope

- src/parser.js: record spans; add the check at the end of parse(), behind an option the test helpers set.
- Run across the whole suite; each violation found is a bug to fix in the parser (never by widening the structural list to hide it).

Acceptance

- The invariant runs on every compile in tests.
- Reverting any of the fixed skips (top-level consume, `} : Type` discard) makes it fail loudly.
- js suite passes with it on.
