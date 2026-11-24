---
status: todo
created: 2026-04-09
---
# Browser: HTML template in script tag

```
<script type=”text/brevity">
  t = <:text Text> {
    <div class="mine">
      { text }
    </div>
  }
  el = <t text="CONTENT" />
  document.body().append!(el)
</script>
```
