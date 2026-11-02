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
@bump = {
  inc = (target *Integer) { target <- target + 1 }
  inc(*count)
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
Text.upper("hello")
List.size([1, 2, 3])
Blob.to_hex("hello")

name *Text = " ada "
name.trim!
```

## Reply Forms

```brevity
return result: 42
return :value
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

## Silent Functions

```brevity
fire. = { count <- count + 1 }   // the glued `.` names it silent
@poke. = { fire... }             // `...` fire-and-forget; absorbs the dot
@log. = (n Integer) {
  if n < 0 {
    return                       // bare `return` exits early
  }
  Log.write.(n)...
}
```

## `!` Functions

```brevity
n *Integer = 0
@inc! = (i Integer) { n <- n + i }   // falls off the end: returns self
@total = { return n }

run! = (f (Integer) => ()) { f(1) }  // `=>` slot takes a function that writes
@go! = {
  run!(&inc!)                        // by reference: `&name!`, never a bare name
  @inc!(1)                           // self-call
  @inc!(1).inc!(2)                   // a chain, as the whole statement or value
  v Integer = @inc!(1).total()
  return v
}
```

## Imports for Details

- [Writing Brevity Quickly](./LLM_WRITING_BREVITY.md)
- [Test-Backed Language Notes](../__tests__/README.md)
- [Core Type Methods](../__tests__/core_types/methods.md)
