wires a message emitter to a service/actor:

```
uses WebView {...service}
view = WebView(...)
view ~ <
  @event = |e| { ... }
>
```

May or may not be needed.
