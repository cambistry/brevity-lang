# Syntax Crib

LLM orientation: compact current syntax patterns for generating Brevity.

## Actor File

```brevity
state *Text = "ready"

@status = -> value: state
```

## Public Handler

```brevity
@ping = -> ok: true

@echo = (text: Text) -> :text
```

## Lineal Handler

```brevity
@add
  =
  a: Integer
  b: Integer
  =
  sum Integer = a + b
  return :sum
```

## Private Helpers

```brevity
#double = (n Integer) -> result: n * 2

@go = {
  :result Integer = #double(21)
  return :result
}
```

## Ref Cell

```brevity
count *Integer = 0
count <- count + 1
```

## By-Ref Parameter

```brevity
count *Integer = 0

@bump! = {
  inc! = (target *Integer) { target <- target + 1 }   // writes the caller's cell
  inc!(*count)
  return value: count
}
```

## Class

```brevity
Box = (seed Integer) *{
  value *Integer = seed

  @get = -> value: value
}
```

## Dependency Header

```brevity
*
  "/services/db": DB {
    lookup (key: Text) -> (value: Text)
  }
*

@query = (key: Text) {
  :value Text = DB.lookup(:key)
  return :value
}
```

## Silent Dependency Call

```brevity
*
  "/services/log": Log {
    write. (message: Text) => .
  }
*

@record. = (message: Text) {
  Log.write.(:message)...
}
```

## Remote Actor

```brevity
*
  "WebView": WebView (path: Text) -> *{
    open. () => .
  }
*

view = *WebView(path: "/main")

@open. = { view.open... }
```

## `a`, `@a`, `#a`

Inside an actor these are three different names, for functions and classes alike. Each may be
declared beside the others, and a call reaches only the one it spells. Outside, only `@a` is
exposed: it's `@a` on the wire, and `.a` in the Brevity that calls it.

```brevity
@Box = *{ @who = -> "public" }
Box = *{ @who = -> "private" }
@Sub = (@Box |) *{}              // superclasses and types use the same name

@go = {
  a = @Box()                     // the public class
  b = Box()                      // the private class
  c @Box = @Box()
  return 1
}

@status = -> "public"
status = -> "private"
@check = { return @status() }    // @status; `status()` would be the private one
```

## Public Class From Another File

A file's public class (`@W = *{ … }`) is constructed through the file, or imported by name.
Bind it before use. A class named with `!` keeps the `!` at the call, and its type doesn't.

```brevity
*
  "svc.bv": Svc
  "other.bv": (:Item, :Widget!)
*

@go! = {
  c = Svc.Counter(5)             // the shared Svc actor makes it
  s = Svc()
  d = s.Counter(5)               // this Svc makes it
  i = Item()
  w Widget = Widget!()           // counts as a write
  return 1
}
```

## Type

```brevity
::Point (x Integer, y Integer)

@x = -> result: Point(1, 2).x as Integer
```

## Core Methods

```brevity
name *Text = " ada "

@go! = {
  u Text = Text.upper("hello")
  n Integer = List.size([1, 2, 3])
  h Text = Blob.to_hex("hello")
  name.trim!()                    // a built-in `!` method writes the cell
}
```

## Reply Forms

```brevity
@a = { return result: 42 }
@b = (value: Integer) { return :value }
```

## Return Paths

A doc shows every path. Paths with the same slots merge, and others alternate, with `self` last.

```
f (Boolean) -> (Integer | Text)            // if b { return 1 }; return "x"
f (Boolean) -> (a: Integer) | (Integer)    // if b { return a: 1 }; return 2
f! (Boolean) => (Integer) | self
g (Boolean) -> (Anything)                  // a path whose type can't be inferred
```

An annotation on a call has to hold for every path, and a destructured key has to be in every shape.

```brevity
x Integer | Text = f(true)
y Integer = f(true) as Integer             // fails the call if it's not an Integer
z Integer = Svc.t()                        // a remote reply is checked, with or without `as`
w Integer = pick(1)                        // an overload: every clause the args could select
v Integer = f() + 1                        // a call in an expression, by its positional returns
u Integer = y                              // a name: an error only if no member of its type fits
```

`as T` renders a value as T or fails the enclosing call with an `ex`, which can't be caught. It never
parses or stringifies.

```brevity
1 as Float                                 // converts; so does 1 as Decimal
t as Blob                                  // Text and Blob convert both ways
x as Integer                               // a whole Float or Decimal passes, 1.5 fails
"x" as Integer                             // compile error: no such rendering
c as Integer                               // an actor is asked, through its `self as Integer`
f() as Object                              // the whole reply
```

## Effects: `!`, `.` and No Mark

A function's name says whether it writes. A function that writes must be named `!` or
`.`, and one named `!` must write. No mark means read-only, and the compiler holds it to
that.

```brevity
n *Integer = 0

@total = -> n                            // no mark: read-only, tail return
@inc! = (i Integer) { n <- n + i }       // `!` writes; falling off the end returns self
@take! = {                               // `return v` returns v
  v Integer = n
  n <- 0
  return v
}
@put! = (i Integer) { return n <- i }    // `<-` as a value: the cell's new value
@reset. = { n <- 0 }                     // `.` is silent: no reply
@clear! = { @reset.()... }               // `...` launches it without waiting
```

- **A `!` body has no tail return.** A final value (`n`, `n + 1`, a bare `self`) is an
  error: write `return n`, or delete it. A final write or `!` call is fine.
- **Every path agrees.** `return v` on one path and falling off the end on another is an
  error: write `return self` on the second.
- **A read-only body's tail is its value**, as before.
- **Writes are:** `<-`, `<|`, `>>` on a cell that outlives the call; a call to a `!` or
  `.` function; a dependency call its doc marks `=>`; a built-in `!` method on a cell.
- **Not writes:** cells local to the call, an `emit`, `untracked` state, and calls on an
  actor this function just made, if they write only that actor.
- **A class that writes while constructing is named `!`**, and so is the call:
  `w W = W!()`. Its actors are typed `W`.
- **A discarded read is an error:** `@total()` alone as a statement.

## Effect Arrows

`->`, `=>` and `~>` state an effect in signatures only: doc entries, function types, type
fields. A body's arrow is always `->`, so `(i Integer) => i` is an error. The compiler
never reads an effect from a name in a doc.

```brevity
*
  "Store": Store {
    get (key: Text) -> (value: Text)                    // reads
    peek (key: Text) ~> (value: Text)                   // claims to read, unchecked
    me () -> self                                       // identity
    put! (key: Text, value: Text) => (count: Integer)   // writes, returns a value
    add! (value: Text) => self                          // writes, returns self
    take! (Boolean) => (Text) | self                    // either; can't be chained on
    log. (Text) => .                                    // writes, silent
  }
*

@glance = (key: Text) {
  :value Text = Store.peek(:key)         // its own doc says `~>` too
  return :value
}

@save! = (key: Text, value: Text) {
  Store.add!(value).add!(key)
  :count Integer = Store.put!(:key, :value)
  Store.log.("saved")...
  return :count
}
```

- **Errors:** `-> .`, `~> .` (nothing to read: write `=> .`), `~> self` (write
  `=> self`, or `-> self` for the identity), `-> (self)` (no parens), `self | (T)` (self
  goes last).
- **`~>` spreads:** any function in the file that reaches a `~>` gets `~>` in its own doc.
  Use `~>` in a hand-written doc unless you own the implementation.
- **A function-typed param states its contract.** `(f (Integer) -> ())` takes only a
  read-only function, `(f (Integer) => ())` takes one that writes.
- **A type field's name matches its arrow:** `run! (Integer) => self`,
  `go. () => .`, `q () -> (Integer)`.
- **Generated docs** carry the arrows: `inc! (Integer) => self`, `take! () => (Integer)`,
  `reset. () => .`.

```brevity
n *Integer = 0

run! = (f (Integer) => ()) { f(1) }       // `=>` slot takes a function that writes
@inc! = (i Integer) { n <- n + i }

@go! = {
  run!(&inc!)                            // by reference: `&name!`, never a bare name
  run!((i Integer) { n <- n + i })       // inline, in a `=>` slot: falls off the end
}
```

## `untracked`

Writes that don't count as effects: logs, metrics, caches. It marks cells, functions and
nested actors, and crosses into docs. An `untracked` function may only write `untracked`
state.

```brevity
*
  "logger.js": Log {
    untracked write. (Text) => .         // stated by the importer
  }
*

Cache = *{
  hits *Integer = 0
  @hit! = { hits <- hits + 1 }
}

untracked calls *Integer = 0             // a cell
untracked @note. = (m Text) {            // a function
  calls <- calls + 1
}
untracked cache = Cache()                // a nested actor

@get = (key: Text) {                     // still read-only
  calls <- calls + 1
  @note.(key)...
  cache.hit!()
  Log.write.(key)...
  return 1
}
```

Its doc lists `untracked note. (Text) => .`. `untracked` is reserved only as a local
name: `@untracked`, a member `x.untracked` and a key `untracked:` are fine.

## Chains

A `!` call that falls off the end returns its receiver, so the next link is a call on
the same actor. Bind first when a link returns a value.

```brevity
Counter = *{
  n *Integer = 0
  @inc! = (i Integer) { n <- n + i }
  @take! = {
    v Integer = n
    n <- 0
    return v
  }
  @total = -> n
}

@go = {                                  // writes only an actor it made: read-only
  c = Counter()
  t Integer = c.inc!(1).inc!(2).total()
  v Integer = c.take!()                  // returns a value: bind it, don't chain on it
  return t + v
}
```

```brevity
n *Integer = 0
@inc! = (i Integer) { n <- n + i }
@total = -> n

@go! = {
  @inc!(1).inc!(2)                       // on this actor: the whole statement
  v Integer = @inc!(1).total()           // or the whole value
  return v
}
```

- **Chaining on a value is an error:** `c.take!().total()`, and any call on a doc's
  `(T) | self`. Bind the result first.
- **A chain on this actor must be a statement's whole value.** `@inc!(1).total() + 1`
  is an error: bind `@inc!(1).total()` first.
- **Passing or storing a fresh actor before writing it** ends the exemption: the
  function then needs `!`.

## Imports for Details

- [Writing Brevity Quickly](./LLM_WRITING_BREVITY.md)
- [Test-Backed Language Notes](../__tests__/README.md)
- [Core Type Methods](../__tests__/core_types/methods.md)
