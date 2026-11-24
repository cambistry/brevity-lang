---
status: done
created: 2026-11-13
---
# Quoted names in Brevity source

  Status: deferred until there's a real use (foreign interop that needs it).

  Depends on: the wire-side quoting in notes/at-sigil-internal-and-quoted-names-2026-11-12.md

  ("Quoted names", "External names that start with a sigil").

‌

  PROBLEM

  Brevity source can't spell some names it may need to consume:

- names containing spaces ('has space')

- foreign names starting with something the source lexer reads specially

      (@foreign, .hidden.file, #tag, ~x, $x)

  The wire already quotes such tokens. Source needs an equivalent.

‌

  FINDINGS (checked 2026-11-13)

- '…' is already the raw Text literal in source, with the same '' escape

      (src/lexer.js ~L380). The delimiters are the same, so the rules can be the same.

- x.'foo'() currently lexes as IDENT \`x.\` (the silent name), then STRING 'foo',

      then (), i.e. a spacious call \`x. 'foo'\`. Quoted member access needs a lexer

      change: \`.\` immediately followed by \`'\` (no space) starts a member name.

      This changes lexing of existing source, so it needs a dedicated test.

- \@'a b' lexes as AT STRING and has no current meaning. The declaration form has room.

- x['k'] is an existing subscript (Object/Map data key). Don't reuse it for members:

      member access is an op on an actor, a subscript is a data lookup.

‌

  PROPOSED DECISIONS (to confirm when picked up)

1. Disambiguation is positional. A quoted name is legal only where an expression

     can't appear:

- immediately after \`.\` in member access    x.'@foreign'()   x.'has space'

- immediately after a declaration sigil      \@'has space'     #'x y'

- as an address token

- as an import alias / in an import path

- as a service-document entry name for a foreign service

     Everywhere else '…' remains a Text literal. No new delimiter, no name prefix.

‌

1. Quoting rule: quotes are required exactly when the unquoted token would lex

     differently or not as one name: contains a space, starts with ', or starts with

     \@ . # ~ $. Quotes when not required are an error (x.'foo' -> write x.foo).

     Use the lexer as the test, not a hand-kept sigil list. \`~\` and \`$\` are included

     because the source lexer treats them specially (\`~>\`, retired \`$\`), even though

     neither is a source sigil.

‌

1. Source -> wire: a quoted name in member access / address position IS the wire

     name, quotes removed. This matches how x.foo already means wire \`foo\` from

     outside an actor.

       x.'@foreign'     -> op '@foreign'

       x.'has space'    -> op 'has space'

       x.'~x'           -> op '~x'   (a foreign service's literal ~x)

     Exception: tokens the wire itself must quote (exactly \`.\`, a leading \`$\`) keep

     wire quoting ('.', '$set'). Source quoting and wire quoting are the same

     operation, applied once.

‌

1. Declarations: consume-only in v1. If declaring is allowed later, it composes as

     visibility sigil + quoted body, using the normal wire mapping:

       \@'has space'   -> wire  has space        (public)

       'has space'    -> wire  ~has space       (protected)  [syntax needs care: in

                                                 declaration position this is

                                                 indistinguishable from a Text literal]

       #'x y'         -> wire  #x y             (private)

     Hard rule if/when allowed: a Brevity public member's wire name may not start with

     ~ or #, start with $, or be exactly \`.\` (it would collide with Brevity's

     protected/private convention or Opre's glyphs). With that rule, inbound wire ->

     member mapping is mechanical: strip a leading ~ or #, and what remains is the body.

‌

  OPEN QUESTIONS

- Defer declarations, or rule them out permanently?

- Protected quoted declaration syntax (bare 'name' at declaration position vs a

      Text expression statement). Is it needed at all?

- Does the \`.'\` lexer rule need a whitespace distinction documented (x.'a' vs x. 'a')?

- Do imports/aliases need quoting beyond what the "[path.bv](http://path.bv "‌")": Alias header form

      already allows?

‌

  SCOPE WHEN IMPLEMENTED

- lexer: \`.\` + \`'\` member-name token; quoted name after \@ / # in declarations (if allowed)

- parser: quoted names in member access, address tokens, import aliases

- codegen (js/rust/erlang): emit quoted names verbatim as wire op/address tokens

- validation: error on unnecessary quotes; error on reserved public wire names

- tests: lexing of x.'foo' vs x. 'foo'; consuming \@foreign / 'has space' / ~x;

      the reserved-name errors

- note in notes/ recording the decisions
