---
status: todo
created: 2026-04-24
---
# nested components

[factory.bv](http://inner.bv "‌")

```
<DOM: (:p)> {
  @inner = <> -> <p>INNER</p>
}
```

[app.bv](http://outer.bv "‌")

```
<"factory.bv": Factory> {
  <div><Factory.inner /></div>
}
```

And a reactive version.

factory.bv

```
<DOM: (:p)> {
  @inner = <:content &Text> -> <p>{ content }</p>
}
```

app.bv

```
<"factory.bv": Factory> {
  @content Text! = "initial"
  <div><Factory.inner content={ @content } /></div>
}
```
