# Opre wire names: `@` leaves the wire, `.` is self, `~` protected, `$` intrinsic — 2026-11-12

Design decision, not implemented. Builds on `opre-addresses-as-tokens-2026-11-11.md` (tokens,
space-delimited) and supersedes the wire spellings in `protected-names-dot-prefix-2026-11-11.md`
(`.a` / `@a` / `#a`).

## The wire at a glance

| Wire | Meaning | Owner |
|---|---|---|
| `name` (bare) | public | — |
| `~name` | protected | Brevity convention |
| `#name` | private | Brevity convention |
| `$name` | intrinsic op | Opre |
| `.` (whole token, address head) | self | Opre |

```
#<.>                                    self
#<. Box 123>                            my instance
{op: [[7], '$set'], to: '. ~val'}       set my protected cell
{op: 'ping', to: 'path/to/service s'}   call a public function, globally
ty: '.'                                 my class
```

## `@` leaves the wire

`@` is no longer a universal Opre prefix on public names. It is a Brevity sigil only. Public names
travel bare:

```
before                     after
#<HTML @div>               #<HTML div>
path/to/service @a /1      path/to/service a 1
main @s @get               main s get
```

Inside Brevity nothing changes: protected names are bare, `#` prefixes private names, and `@`
stays part of the local name of a public member:

```
@var
@singleton method
```

- **The wire name is the name.** A public function is *named* `get`; `@get` is how Brevity
  source spells it. A bare source `fn` is named `~fn`, and `#x` is named `#x`. The three source
  labels stay distinct because their names differ. (Admittedly confusing; may be rethought.)
- **A synthesized name keeps its `@`.** A closure's `@0` or an event endpoint's `@__evt_…` is the
  whole name, not a public member `0`: `#<main @0>`, relative `#<. @0>`. A token may start with
  any character, so this costs the token rules nothing.
- **Public op names drop `@` too:** `op: 'ping'`, not `op: '@ping'`.
- **`@` only touches the head of an address.** Later segments are local to child contexts, not to
  the immediate one. Each child spells its own public names with `@` internally; the address that
  reaches it doesn't. So `@singleton method`, not `@singleton @method`.
- **Opre knows only space delimitation,** plus two glyphs of its own: the self token `.` and the
  intrinsic-op prefix `$`. As prefixes, `~` and `#` mean nothing to it; they're Brevity's
  convention.

## Protected: `~`

A protected (bare-in-source) name takes a leading `~` on the wire: `~helper`, `~val`,
`~_lambda_N`. Supersedes the leading `.` of `protected-names-dot-prefix-2026-11-11.md`; that note's
scope (bus messages for protected functions and cells, subscriber and snapshot keys) stands.

- **`.` was too quiet and overloaded.** In source it is public member access (`x.val`), the
  silent suffix (`note.`) and the silent return type. A dot meaning public in source and protected
  on the wire needed its own explanation.
- **`~` reads as "near":** between public and private, reachable from the actor's own
  neighbourhood.
- **Wire-only.** Protected names stay bare in source; the lexer uses `~` only in the `~>` arrow.
- **Safe in transit:** unreserved in URIs (RFC 3986), ordinary in JS, Rust and Erlang strings.
- **`.hidden.file` is just a name.** A leading `.` no longer looks protected.

## Quoted names

A token containing spaces is written in single quotes:

```
'file/with spaces/' Name
```

- **Quotes are valid only when required.** `'no-spaces-here'` is an error.
- **Single quotes self-escape inside quotes:** `'this isn''t ready'`.
- **Doubling is only valid inside quotes.** Unquoted, `'` is an ordinary character:
  `Chris's-Computer`, never `'Chris''s-Computer'`.
- **A token that starts with `'` must be quoted:** `'''tis'`. This is a narrow exception to
  "quotes only when required": unquoted, the leading `'` would open a quote.
- **Reserved whole tokens are quoted when meant literally:** `'.'` (not self), `'$set'` (not an
  intrinsic).
- Replaces the `\ ` space escape in `opre-addresses-as-tokens-2026-11-11.md`.

### External names that start with a sigil

Locally, quotes also mark an external name that begins with one of Brevity's internal sigils, so it
isn't read as a local label:

```
'@foreign'          // a non-local name that happens to start with @
'.hidden.file'
```

On the public wire the quotes drop: the token is just `@foreign` / `.hidden.file`.

So, locally, quoting is required exactly when a token contains a space, starts with `'`, or starts
with `@`, `.` or `#`.

## `.` is self: the relative-address marker

An Opre-level convention. The token `.`, exactly, is a specific actor: self. An address whose head
token is `.` is relative to the sender:

```
. opname                 // child-relative
file/path Svc 1          // global
'.' abc                  // quoted: a global whose head token is literally `.`
```

- **Why `.`, not `@`:** it is computing's most widely understood "here" (`.`, `./x`), so
  `#<. Box 123>` reads as `./Box/123` with no Brevity knowledge. It also keeps `@` free for the
  Opre ecology (`@something` may name libraries or system resources) and avoids a one-space
  near-miss with Brevity's source `@x`. The cost is resonance with Brevity syntax.
- **The test is mechanical:** head token `.` means relative; anything else is global. A host needs
  no knowledge of Brevity's sigils.
- **Only the exact token is reserved.** `.hidden.file`, `@something` are ordinary tokens.
- **Translation per hop:** a parent receiving `. x` from child `c` rewrites it to `. c x`. That is
  still relative, now to the parent. The node at the global boundary replaces `.` with its own
  address.
- **Payload addresses still need `#<…>`.** `.` marks locality; the brackets mark that a string is
  an address: `#<. Box 123>`. `to`, `from`, `re` and `ty` are known address fields.
- **What follows the head is the sender's business.** How an actor or subactor formats the rest of
  its address isn't Opre's concern.
- **`ty` uses the same token.** "My class" is `ty: '.'` (was a bare `@`): self and my class are
  both the sender's own frame. A local type tag is `. ::Point`, not `::Point`; it is no longer
  local by virtue of its leading delimiter.
- **`..` is not defined.** It would suggest a parent, i.e. upward addressing, which CAM avoids.

## Instance addresses

Space-delimited, no slash: `. Box 123`, globally `path/to/service Box 123`. Replaces `@Box/1`.

## Intrinsic ops: `$`

- **Every intrinsic op takes `$` on the wire:** `$get`, `$set`, `$new`, `$subscribe`, `$update`,
  `$as`. This replaces `#new` / `#set` and the bare `get`, `set`, `update`, `subscribe`, `as`;
  nothing intrinsic is bare or `#`.
- **`$` is an Opre-level glyph,** like the self `.`: an op that starts with `$` is a protocol
  intrinsic. A foreign op that really starts with `$` is quoted (`'$set'`). Precedent: MongoDB's
  `$set` / `$inc` update operators, JSON Schema's `$ref` / `$id`.
- **No Brevity name can produce it.** `$` is not a source sigil (the lexer rejects it as the
  retired state-variable syntax), so intrinsics collide with no public, protected or private name.
- **Why not `#`:** sharing the private sigil made every intrinsic a ban on a private name, and `#`
  already appears in `#<…>`. With `$`, `#` means only private.
- **Reserved names:** `#set` is free as a private function. Bare `set` in source stays reserved,
  but only as a keyword of the source grammar, not because of the wire. A public `@set` (wire
  `set`) was never in conflict. The same holds for each intrinsic.

## Cell ops address the cell

The compound arms (`set@val`, `subscribe@val`, `get@val`, `new@Good`) and the protected setter
`set.val` are retired. A cell or class is the last token of the address, and the intrinsic is the
op:

```
{op: [[7], '$set'], to: '. val'}          // was op [[7], 'set@val']
{op: [[7], '$set'], to: '. ~val'}         // protected; was to '.val'
{op: '$subscribe', to: 'Box 1 val'}       // was op 'subscribe@val', to '@Box/1'
{op: [{}, '$new'], to: '. Box'}           // was op [{}, '#new'], to '@Box'
```

- **One token space per actor.** Cells, singletons and instances share it. An intrinsic aimed at a
  token it doesn't apply to answers unhandled.

## Functions, cells and props

Where `$get`, `$set` and `$subscribe` apply depends on what a member is.

- **Function:** an op. A one-off call is `{op: [[a, b], 'fn']}`. Subscribing makes it an
  address, with the args in `$subscribe`'s slots: `{op: [[a, b], '$subscribe'], to: '. fn'}`.
- **Cell:** an address, whether writable or not. The verbs are the same for both:

  ```
  {op: '$get', to: '. cell'}
  {op: [[123], '$set'], to: '. cell'}       // writable (`*`) cells only
  {op: '$subscribe', to: '. cell'}
  ```

- **Prop:** not an actor, so it receives nothing. It is an attribute of its actor, read with
  `{op: 'prop'}`. It is not an address, so it can't be subscribed to.

| | `$get` | `$set` | `$subscribe` |
|---|---|---|---|
| cell, `&` | yes | no | yes |
| cell, `*` | yes | yes | yes |
| cell, write-only | no | yes | no |
| function | no | no | yes |
| prop | not an address | | |

A verb that doesn't apply answers unhandled.

### In the service document

```
seen &Integer           read-only cell
count *Integer          writable cell
set label (Text)        write-only cell
total Integer           prop
sum (a: Integer) -> (Integer)
```

- **`&` is a new entry form.** A bare `name Type` is a prop; `&` and `*` make it a cell.
- **The emitter writes `&`** for a public cell with no setter: one whose type has no
  synthesized setter (`@names *List of Texts = []`). A class's public cells are written as
  cells too (`slot *Integer`), not as zero-arg functions. Published params are props.
- **`set label (Text)` stays, as a write-only cell.** It answers `$set` only; reading or
  subscribing to it is an error. It keeps the DOM manifest's write-only properties
  (`inner_html`, `text_content`, `value`, `scroll_top`, …) writable without making them
  readable or live.

### Compiling a member access

- **Read:** `Remote.seen()` on a cell is `{op: '$get', to: 'Remote seen'}`; on a prop it is
  `{op: 'total', to: 'Remote'}`.
- **Subscribe:** on a cell or function, `$subscribe` to `… name` (a function's args in the
  slots). On a prop, a compile error: `'Remote.total' is a prop, not an address, so it can't
  be subscribed to`. On a write-only cell, also a compile error.
- **Write:** `Remote.count <- 5` on a `*` cell or write-only cell is `$set` to `… count`. On
  a prop, a compile error ("not an address"); on an `&` cell, a compile error ("read-only
  cell").

### Answering

Each actor has one table of the names it answers `$get` for: its cells, and, for a file
actor, its constants and params.

- **A public cell answers anyone,** through its own reader, so the reply is typed.
- **Every other name** (a protected or private cell, a constant, a param) answers only from
  inside the actor, and from a class declared in it (outer reads, below). From outside,
  `$get` to it is unhandled.
- **A prop** answers `{op: 'prop'}` only; `$get` and `$subscribe` to its name are unhandled.

## Outer reads are `$get`

A class reading a cell of an actor it's declared in (`src/outer_reads.js`) sends `$get` to
that actor's name: `{op: '$get', to: '. ~total'}`. Same op, same table, as any other cell
read. It replaces three in-process mechanisms (JS's `$get`-shaped message intercepted
before dispatch, Erlang's private `bv_outer_get` key read, Rust's direct read of the
owner's state).

- **The bus is internal.** Actors inside a process exchange Opre-shaped messages. Most never
  leave through a node. An outer read is one of those, not a wire message.
- **`to` is relative to the owner.** The class hands the message to the owner it was
  constructed under (its chain, a capture), and the owner reads `. ~total` as its own name.
  The class names no parent: this is not upward addressing, and `..` stays undefined.
- **A class may read the owner's `~` names.** Protected means reachable from the actor's
  neighbourhood and never exposed outward. A class the actor constructed, asking over the
  internal bus, is in that neighbourhood. Nothing outside gains access.
- **A name not yet declared:** the read is held until the name's line runs
  (`forward-reads-in-constructor-blocks-2026-11-11.md`). Rust, on one thread, gets the same
  effect by running the class's construction after the last line it waits on.
- **When it's answered:** at the owner's next wait, or once its current turn ends. Never in
  the middle of a statement. So a call a turn launches (`w.look...`) or makes silently
  (`w.look.()`) doesn't run inside that turn. It is delivered and runs once the class takes
  it. Under T2 turns, this fixes what an outer read sees:

  ```
  @race! = {
    w.look...        // W's read of total is answered after this turn: 5
    total <- 5
    return 1
  }
  ```

  Each target implements it its own way:
  - JS posts the read on a microtask.
  - Erlang sends a launched call without waiting.
  - Rust queues launched calls and runs them when the turn ends, or before a call that
    waits.

  A call that waits on a class first lets the queued ones run, so a class takes its
  messages in the order they were sent.
- **Out of scope:** call-scoped turns (T3). This fixes what an outer read sees under today's
  T2 turns only.

- **A prop reads like a zero-arg function** (`{op: 'prop'}` / `{op: 'fn'}`), so props and
  zero-arg functions have uniform access. They differ only in that a function is subscribable.
- **`val Integer` and `val &Integer` are accessed differently on the wire.** That is accepted. A
  snapshot attribute and a live actor are different contracts. Source `x.val` is the same for both;
  the compiler picks the wire form from the service document.
- **`x.val <- 5` on a prop is a compile error.** The prop isn't an address.
- **This retires subscribing to a plain field** (the 2026-10-29 service-doc note has `.subscribe`
  on read-only fields). A live read-only field is an `&` cell.

## Supersedes the leading-character local/global rule

This replaces the broad "a leading delimiter means local; a leading word character means global"
rule (`address-delimiter-change-plan-2026-04-23.md`, and its use in
`protected-names-dot-prefix-2026-11-11.md`). Apart from the reserved head token `.`, a wire token
may start with any character: `.hidden.file` and `@foreign` are ordinary names. Within Brevity
source, locality is expressed by the sigils and quoting above.

## Not affected

- **Consumption:** wire `a` is consumed in Brevity as `x.a`, unchanged in source; only the wire
  spelling moves from `@a` to `a`.

## Open

- **`ex` keys lose the target** once compound ops are retired (`ex: {'$set': …}`). Accepted for
  now; tracked as a follow-up.
- **Generated identifiers** for `~` names in Rust and Erlang need a spelling (the `.` was `_d_`).
- Migration: every target's routing, tagging, subscriber keys, and every test's addresses.
