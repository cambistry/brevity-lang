---
created: 2026-04-09
---
# Browser: load .bv file

```
<head>
  <script src="brevity.js"></script>
  <script type="text/brevity" src="/app.bv">
</head>
```

```
<:document *> // DI
=
body = document.body()
el = <p>Paragraph</p>
body.attach!(el)
```
