---
status: todo
created: 2026-04-09
---
# Browser: load HTML template from file

index.html

```
<script type=”text/brevity” src=”/widget.bv”></script>
<script type="text/brevity">
  body = document.body()
  widget = <widget />
  body.append!(widget)
</script>
```

/widget.bv

```
widget = <:div> ->
<div class="widget">Widget</div>
```

‌

`widget =` or `@widget =` ?

Is this running “in” document or in some top-level actor space? That seems incompatible with the file-as-actor model. Revised:

index.html

```
<script type=”text/brevity” src=”/widget.bv”></script>
<script type="text/brevity">
  <"/widget.bv": (widget) *>
  body = document.body()
  widget = <widget />
  body.append!(widget)
</script>
```

/widget.bv

```
<:div> -> <div class="widget">Widget</div>
```

This may be exercising file-as-constructor in a new way for this project.
