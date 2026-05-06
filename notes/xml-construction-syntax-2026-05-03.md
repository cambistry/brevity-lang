# XML-Shaped Construction Syntax — Design Sketch — 2026-05-03

Exploratory design for making XML-like syntax the canonical form for class
construction in brevity, with standards-compliant XML/HTML as a legal
subset of the language. Conversation-stage; not yet specified or
implemented.

Status: **brainstorm**. Worth a real design pass before committing.

---

## Core proposal

Construction of any class uses XML-shaped syntax:

```
user  = <User name="Fred" org=1932 birthday=#2003-01-01#>
empty = <Greeter>
pair  = <Pair 3 4>           // positional, whitespace-separated
named = <Pair a=3 b=4>       // named (preferred for 2+ args)
typed = <Integer 0>          // single-positional / typed value literal
```

This replaces `Greeter()`, `Pair(3, 4)`, `Integer(0)` etc. as the construction
form. The `<>` shape used today for class **definition** has to move
(stand-in: `<<...>>`, or a `class` keyword form — open question).

## Guiding constraint: XML/HTML is a legal subset

The strongest version of the proposal is not "borrow XML aesthetics" but
**"standards-compliant XML/HTML is a legal subset of brevity construction."**
Pasting any well-formed HTML fragment into a brevity program parses
correctly.

The superset is **one-way**: every well-formed XML/HTML element is a legal
brevity construction; not every brevity construction is valid XML.
Brevity's extensions (positional args, unquoted expression values,
keyword-prefix attributes, heredocs, macros) are not XML-valid, but XML
input always is.

What this resolves automatically:
- HTML void elements (`<br>`, `<hr>`, `<img>`) work as-is.
- Body construction `<X>...</X>` is general, not HTML-only.
- Mixed content `<p>Some <em>bold</em> text</p>` is part of the grammar.
- `<!--...-->` comments and `<![CDATA[...]]>` raw text inherited free.
- Attribute names with hyphens (`data-foo`), colons (`xml:lang`) — required.
- Entities (`&amp;`) decode at parse time.
- HTML's `<script>`/`<style>` raw-text rule should be inherited (otherwise
  pasted `<script>const x = a < b;</script>` breaks).

What this enables:
- Paste arbitrary HTML/JSX into brevity source and it parses.
- Every HTML page on the internet is a free fixture corpus.
- LLMs already speak HTML; UI generation becomes "HTML with brevity
  expressions in attribute values."
- The DOM module isn't a templating language — it's just brevity. No
  separate JSX-to-JS transform, no `{{ }}` interpolation grammar.

## Slash rule

Closing slash for self-closing tags is **optional for classes with no
children attribute**, **required for classes that declare children**.

```
<User name="Fred">             // User has no children attribute. Self-closes implicitly.
<List items=[1,2,3]/>          // List declares children. Slash asserts "no body."
<List items=[]>...</List>      // Same class, body form.
```

Three forms, one rule. Mirrors HTML5's void-element behavior but
generalizes from a hardcoded list to "whatever the type definition says."

The slash carries assertion-of-intent: it says "this class *could* take
children, I am asserting it doesn't." For classes that can't take
children, the slash is noise.

Trade-offs:
- Reading `<Foo bar>` cold (without type info) you can't tell whether
  it's a valid no-children class or a malformed open tag. Tooling answers
  instantly; grep and PR-diff don't.
- Adding/removing a `children` attribute on a class becomes a non-local
  refactor — every construction site is affected. Mechanical fix, but
  worth being honest about.
- Parser implementation choice: type-driven (look up class def) vs.
  always-lookahead-for-`</X>` (grammar-internal). Type-driven preserves
  the assertion-of-intent benefit; lookahead is simpler.

## Argument forms

| Form | Example | Notes |
|---|---|---|
| Bare flag | `<User admin>` | Equivalent to `admin=true`. HTML5-style. |
| Named  | `<User name="Fred">` | XML-canonical. Preferred for 2+ args. |
| Keyword-prefix | `<Range from 0 to 100>` | Sugar for `from=0 to=100`. |
| Positional | `<Pair 3 4>` | XML extension. Whitespace-separated. |
| Mixed | `<List of Integer 1 2 3>` | Keyword-attr then positional. |

**Keyword-prefix attributes** are the breakthrough. Once construction
sits inside `<>` and `=` is optional when the value is a single
expression, prepositions become readable:

```
range = <Range from 0 to 100>
m     = <Map from Text to Integer>
conn  = <Connection to "wss://example" with auth=token>
job   = <Job runs every "5m" until "2026-12-31">
list  = <List of Integer [1, 2, 3]>
```

The function-call equivalents are all torture (`Range(0, 100)` loses
from/to; `Map<Text, Integer>(...)` puts type and data on different
planes; `Connection("wss://...", auth: token)` has no place to put `to`).

Reserved-word set must be designed: `of`, `from`, `to`, `with`, `by`,
`for`, `as`, `into`, `until`, `every`, `at`, `runs`, etc. Open question:
universal across all classes, or per-class declared vocabulary?
Probably universal — the keyword set is small and globally meaningful,
classes opt in by naming attributes from it.

## Generics: named-attribute, not bracket

`<List<Integer>>` is **ambiguous**:

- Parse A (intent): `List` parameterized over `Integer`.
- Parse B: `List` with a positional arg that is itself a construction
  `<Integer>`.

This is the TypeScript/TSX generic-arrow problem. Brevity sidesteps it
by treating type parameters as named attributes:

```
<List of=Integer>
<List of Integer 1 2 3>          // with keyword-prefix sugar
<Map from=Text to=Integer>
```

No separate generic bracket grammar. Type parameters ride the same rail
as everything else.

## Method chaining

`<Pair a=3 b=4>.sum()` reads better than `Pair(a:3, b:4).sum()` — the
`>` is a hard close-bracket that visually terminates the construction,
making allocation a syntactically distinct unit. The whole point of
`<>`-shaped construction is that allocation becomes visible.

Long chains (`<User>.first().second().third()`) are angular rather than
prose-like, but unambiguous and readable.

## Three-sigil taxonomy

The lexer dispatches on the first character after `<`:

| Shape | Meaning | Examples |
|---|---|---|
| `<TypeName ...>` | Value construction | `<User name="x">`, `<Pair 3 4>` |
| `<:name ...>` and `<! ...>` | Macro invocation | `<:if cond>`, `<:for x in xs>`, `<:doc>`, `<!>...</!>` |
| `<!-- -->` | Comment (inherited XML) | `<!-- TODO -->` |
| `<? ... ?>` | Processing instruction (optional) | `<?xml version="1.0"?>` |

`<!>` and `<!name>` are conceptually **part of the macro vocabulary** —
they're not a separate category. The `<!` form is a syntactic shortcut
for "raw-body macro with collision-proof delimiter," which is common
enough to deserve a dedicated shape. Mentally:

- `<!>...</!>` ≡ the anonymous raw-text macro
- `<!name>...</!name>` ≡ the raw-text macro with a user-chosen
  delimiter token to avoid `</!>` collisions

Lexer-side, the `<!` shape avoids a macro-table lookup: any `<!` opening
guarantees raw-body and structural close-matching without consulting
the macro registry. That's a real ergonomic win for the common case,
not a separate concept.

So the user-facing story is **three meanings**: construction, macro,
comment (with processing-instruction as an optional fourth for full XML
parity). The bang-form is "shorthand for the most common kind of macro."

### Construction (`<TypeName>`)
Capitalized first identifier. Standard XML-shaped grammar plus brevity
extensions. Most common form.

### Macros (`<:name>`)
Brevity's macro / language-meta namespace. A macro decides:

- What its attributes mean (named, positional, bare, keyword-prefix).
- How its body parses (raw text, parsed children, quoted AST).
- When it runs (compile time, runtime, both).
- What it returns (Text, Element, Element-list, AST, side effect).

Examples:
```
<:doc>...</:doc>                     // raw-text macro, returns Text
<:if cond>...</:if>                  // runtime conditional, returns Element-list
<:for x in xs>...</:for>             // template loop
<:slot name="header">...</:slot>     // template slot
<:include "header.bv"/>              // compile-time include
<:sql>SELECT * FROM users</:sql>     // embedded DSL
<:markdown>...</:markdown>           // rendered to HTML
```

Stage 1 plan: fixed set of compiler-defined macros (`<:doc>`, `<:if>`,
`<:for>`, `<:slot>`, `<:include>`). User-defined macros (Stage 2/3)
deferred — true macro systems are easy to design badly (hygiene, error
reporting through expansions) and the fixed set covers most needs.

### Raw text / heredoc (`<!name>` and `<!>`)
Conceptually a macro in the same vocabulary as `<:doc>`, but with a
shortcut sigil because the use case is common: raw-body content with a
collision-proof delimiter. The token name's only job is to make the
close tag unique when body content might contain `</!>`.

```
note = <!>
  any literal text, terminator is </!>
</!>

sql = <!query>
  SELECT * FROM users WHERE name LIKE '%</!>%'   -- contains </!>, no collision
</!query>
```

The `<!>` form is the recommended default for quick raw text. Use the
named form `<!token>...</!token>` only when the body might collide with
`</!>`.

`<!>` accepts attribute qualifiers:

```
text = <! dedent>
  Hello,
  World
</!>

text = <! raw>...</!>          // no entity decoding, no escapes
text = <! trim dedent>...</!>  // multiple flags
```

These are bare-flag attributes (`dedent` ≡ `dedent=true`), same as
elsewhere in the construction grammar. The heredoc inherits brevity's
attribute machinery rather than inventing its own.

Body parse mode is **raw** by default: lexer enters raw-text mode after
`<!` (or `<!name`) and scans for the literal `</!>` (or `</!name>`). No
escape sequences in raw mode — if you need the literal terminator
in the body, change the name.

### XML directives (inherited under `<!`)
Inherited XML/HTML directives live in the same `<!` namespace:

```
<!-- comment -->
<![CDATA[...]]>
<!DOCTYPE html>
```

Disambiguation by character following `<!`:
- `--` → comment
- `[` → CDATA
- Reserved name (`DOCTYPE`, `ENTITY`, `ATTLIST`, `ELEMENT`, `NOTATION`)
  → XML directive, parsed/stripped per HTML5 conventions.
- Anything else `<!name>...</!name>` → brevity heredoc.

The reserved-name list is small, globally known, and unlikely to grow.

### Processing instructions (`<? ?>`)
Optional. Inherited XML/HTML form. Probably parsed-and-stripped or
treated as compiler directives. Decide later.

## Heredoc / multi-line strings

The macro+heredoc design solves the multi-line-string problem most
languages get wrong:

```
sql = <:doc>
  SELECT *
  FROM users
  WHERE id = 1
</:doc>

readme = <! dedent>
  # Brevity

  A language with XML-shaped construction.
</!>
```

No backslash-newline soup, no leading-pipe sigils, no triple-quote
ambiguity, no escape-character pollution. Terminator is structural,
not character-based, so embedded quotes and special characters are
fine.

Three options for whitespace handling, in priority order:
1. **Dedent to closing tag's column** (Ruby `<<~`-style) — what users
   want 95% of the time. Probably the default with attribute opt-out.
2. **Trim leading/trailing newline** — common heredoc convention.
3. **Verbatim** — every byte preserved.

`<! dedent>` opt-in for case 1, `<! verbatim>` for case 3, default
behavior is case 2 — or commit to dedent as the always-on default and
have `<! verbatim>` as the escape hatch. Worth deciding.

## Class definition syntax (open)

`<>` is currently brevity's class-definition syntax. Construction
adoption forces it to move. Stand-in used in scratch experiments:

```
Pair = <<
  a Integer
  b Integer
  @sum = -> total: (a + b)
>>
```

Visually continuous with old `<...>`, distinct from construction's
`<...>`. Not a final answer; a `class` keyword form is also viable:

```
class Pair {
  a Integer
  b Integer
  @sum = -> total: (a + b)
}
```

This is a separate design call. The construction syntax doesn't depend
on the choice.

## Open questions to settle before committing

1. **Class definition syntax.** `<<...>>` (continuity), `class` keyword
   (familiarity), or something else?
2. **Positional separator.** `<Pair 3 4>` (XML-style, whitespace) or
   `<Pair 3, 4>` (function-call-style, commas)? Whitespace fits XML;
   commas help the eye when args are short. The keyword-prefix form
   makes positional rare anyway, so the choice may not matter much.
3. **Reserved keyword set.** `of`, `from`, `to`, `with`, `by`, `for`,
   `as`, `into`, `until`, `every`, `at`, `runs`. Universal vs.
   per-class. Likely universal.
4. **Heredoc default whitespace policy.** Dedent always, trim newlines,
   or verbatim? Probably dedent.
5. **Slash-rule disambiguation strategy.** Type-driven or
   grammar-internal lookahead?
6. **Doctype and processing-instruction handling.** Parsed-and-stripped
   preamble, or full disallow?
7. **`<script>`/`<style>` raw-text inheritance.** Likely yes; without
   it, pasted JS with `<` operators breaks.
8. **Macro system scope.** Fixed built-in set (Stage 1) only? When and
   how to open up user-defined macros?
9. **Bare attribute semantics.** `<User admin>` ≡ `admin=true`?
   Type-driven (must be a Boolean attribute) or universal (any
   attribute can be bare-flag)?
10. **Expression-as-attribute-value escape.** JSX uses `{...}` to embed
    expressions in attribute positions. Brevity may want `<User
    name=expr()>` to work *unquoted* (since brevity isn't constrained
    by HTML's quote rules), but a `{...}` form may still be needed for
    clarity inside body content.

## Smoke test before committing

Take ~20 lines of construction-heavy brevity from `__tests__/` and
rewrite in the new syntax. If every line reads as well or better,
proceed. If any line reads worse, that case marks the boundary —
either fix the syntax or accept that the new form is "primary, not
only" and keep `Type(...)` as the secondary form.

A worked example exists in `__tests__/constructors/sugared.test.js`
(temporary, expected to be reverted) — first pass shows construction
sites read clearly better, with the named form (`<Pair a=3 b=4>`)
notably ahead of the positional form (`<Pair 3 4>`) for 2+ args.

## What this changes about the bigger picture

If adopted, several other language decisions snap into focus:

- **Templates aren't a separate sublanguage.** HTML/DOM construction is
  brevity construction; conditionals/loops are macros in the same
  syntax. No JSX transform, no `{{ }}` interpolation language, no
  v-if/x-show fragmentation.
- **Self-hosting becomes more attractive.** A compiler written in
  brevity can use this syntax for AST construction, DOM emission,
  embedded DSLs (SQL, regex, codegen templates) — all the same shape.
- **The "what is brevity for" answer sharpens.** Brevity becomes "a
  language whose primary construction form is XML-shaped, which makes
  it natively good for templating, DOM, and structured-data
  workflows."

The thing that derails the proposal would be discovering, on the smoke
test, that *non-template* brevity code (compute-heavy, list-shaped,
algorithmic) reads worse with `<>` construction. If the angular
brackets help DOM/data code but hurt algorithm code, the right answer
is "primary, not only" — keep function-call construction available
alongside.
