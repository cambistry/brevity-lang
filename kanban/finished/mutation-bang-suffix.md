---
created: 2026-10-31
---
# Mutation bang suffix

⏺ The write-up is in notes/mutation-suffix-2026-10-31.md, and nothing is committed or implemented yet. I also marked notes/bang-returns-self-2026-10-27.md as superseded and updated my project memory.

**The rule as written:**

- **Suffixes:** no suffix means read-only, ! means it writes, and . means no reply.
- **Returns:** a ! function falls through to self or uses an explicit return, and a tail value is a compile error.
- **Foreign** **functions:** the service doc is the contract, and names in it are never interpreted.

**Reading** **the** **code** **changed** **a** **few** **things:**

- **@inc! doesn't** **parse** **yet:** the lexer has no ! name suffix, the existing notes say the parser rejects these declarations, and no test declares one. I didn't compile an example to confirm it, but Phase 1 has to add this first.
- **No** **clobbering** **needed:** the five toggle!/replace! lines in the DOM manifest that return Boolean are now valid as they stand, so the old plan to force them to return self is gone. The byproduct channel tiers from the old note are gone too.
- **Migration** **is** **larger** **than** **it** **looks:** <- alone appears on about 300 test lines in 44 files, and contagion adds their callers. There's also no effect analysis today, so that pass is new work.

**Rulings** **I** **added** **that** **we** **didn't** **explicitly** **discuss,** **so** **check** **these** **first:**

- <|, >> and built-in *x.method!() count as writes.
- set/update handlers, on handlers and subscription bodies write without needing a suffix.
- An inline function's writes count against the function that defines it, so a function that only creates and returns a writing closure still needs a bang.
- A function with a bang that never writes is an error, except when implementing a declared ! interface member.
- The add_child! warning stays, for a ! function that returns its own class but not itself.

**Implementation** **order:**

1. Declaring ! functions and their return rules
1. (acc <- x) as an expression
1. Service doc contracts
1. Effect inference and enforcement, including the corpus migration

Phases 1 and 2 can start now.

**Decisions that block later phases:**

- **Phase 3:** the spelling of the effect marker in docs. I recommended a read prefix, as in read len () -> (Integer), because undeclared means "may write". The wire-name alias also blocks Phase 3, but only for Brevity actors serving a foreign protocol.
- **Phase 4:** the spelling of the non-transactional marker.

The note also lists smaller open questions, with my recommendations, that don't block any phase. The Brevity snippets in the note are illustrative and haven't been compiled, including items *List of Integer = [].
