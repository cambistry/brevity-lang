---
created: 2026-04-18
---
# DOM element content (child) closure subscription

factory.bv

```
<DOM: (:div) *> {
  @content *Text = "initial"
  @create = -> <div>{ @content }</div>
}
```

app.bv

```
<
  DOM: (:div) *
  "factory.bv": Factory *
> {
  el div = Factory.create
  DOM.document().body().append!(el)
  ...
  Factory.content <- "updated"
}
```
