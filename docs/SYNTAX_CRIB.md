# Syntax Crib

LLM orientation: compact current syntax patterns for generating Brevity.

## Actor File

```brevity
state Text! = "ready"

@status = -> value: state
```

## Public Handler

```brevity
@ping = -> ok: true

@echo = (:text Text) -> :text
```

## Lineal Handler

```brevity
@add
  =
  :a Integer
  :b Integer
  =
  sum Integer = a + b
  -> :sum
```

## Private Helpers

```brevity
#double = (n Integer) -> result: n * 2

@go = {
  :result Integer = #double(21)
  -> :result
}
```

## Ref Cell

```brevity
count Integer! = 0
count <- count + 1
```

## By-Ref Parameter

```brevity
@bump = {
  inc = (target Integer!) { target <- target + 1 }
  inc(&count)
  -> value: count
}
```

## Constructor

```brevity
Box = <seed Integer> {
  value Integer! = seed

  @get = -> value: value
}
```

## Dependency Header

```brevity
<
  "/services/db": (DB) {
    lookup: (:key Text) -> (:value Text)
  }
>
=

@query = (:key Text) {
  :value Text = DB.lookup(:key)
  -> :value
}
```

## Silent Dependency Call

```brevity
<
  "/services/log": (Log) {
    write: (:message Text) -> .
  }
>
=

@record = (:message Text) {
  Log.write(:message) .
}
```

## Remote Instance

```brevity
<
  "WebView": (WebView) <:path Text> -> {
    open: () -> .
  }
>
=

view = WebView!(path: "/main")

@open = { view.open() . }
```

## Shape Type

```brevity
::Point = (x Integer, y Integer)

@x = -> result: Point(1, 2).x as Integer
```

## Core Methods

```brevity
Text.upper("hello")
List.size([1, 2, 3])
Blob.to_hex("hello")

name Text! = " ada "
name.trim!
```

## Reply Forms

```brevity
-> result: 42
-> :value
-> .
```

## Imports for Details

- [Writing Brevity Quickly](./LLM_WRITING_BREVITY.md)
- [Test-Backed Language Notes](../__tests__/README.md)
- [Core Type Methods](../__tests__/core_types/methods.md)
