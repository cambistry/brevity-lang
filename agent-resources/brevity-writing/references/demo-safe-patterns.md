# Demo-Safe Patterns

These patterns are intentionally small and repetitive. Copy them rather than
trying to compress them.

## 1. Simple Public Status Handler

```brevity
@status = -> ok: "ready"
```

Use this for health, readiness, and obvious demo-visible state.

## 2. Service Call and Return

```brevity
<
  "services/db": (DB) {
    lookup: (:key Text) -> (:value Text)
  }
>

@fetch
  =
  :key Text
  =
  :value Text = DB.lookup(:key)
  -> :value
```

Use this when the actor delegates to a declared dependency and returns the result.

## 3. Service Call, Transform, Return

```brevity
<
  "services/math": (Math) {
    double: (:n Integer) -> (:result Integer)
  }
>

@compute
  =
  :n Integer
  =
  :result Integer = Math.double(:n)
  -> answer: result + 1
```

Use this when you want to show application logic layered over a dependency call.

## 4. Remote Instance at File Init

```brevity
<
  "WebView": (WebView) <:path Text> -> {
    open: () -> .
    getTitle: () -> (:title Text)
    close: () -> .
  }
>

view = *WebView(path: "/my_view")

@open = { view.open() . }

@workflow
  =
  view.open()
  title: Text = view.getTitle()
  view.close()
  -> :title
```

Use this when the actor owns a long-lived remote surface such as a WebView.

## 5. Factory With Mutable Content

```brevity
<DOM: (:div) *>

content *Text = "initial"

@bump = |:v Text| { content <- v . }
@create = -> <div>{ content }</div>
```

Use this when you need a small reactive demo surface.

## 6. Echo / Round-Trip Handler

```brevity
@echo = |:text Text| ->(:text)
```

Use this for smoke tests and wiring checks.

## 7. Prefer Explicit Multi-Step Flow

```brevity
@saveAndReport
  =
  :key Text
  :value Text
  =
  DB.put(:key, :value) .
  -> ok: "saved"
```

Use obvious sequencing. Avoid packing too much into one expression.
