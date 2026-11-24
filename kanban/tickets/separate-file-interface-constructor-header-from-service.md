---
status: done
created: 2026-04-16
---
# separate file interface constructor header from service interface.

EVERY BREVITY FILE IS A CONSTRUCTOR. Even if it has no construction params. It defines a service. Even if it is ephemeral, i.e. has no public interface and therefore no reason to persist.

When a BV file is being referenced as a _service_, the client does not need its constructor params. It _does_ need construction params if it intends to instantiate the file itself.

Conversely, the hosting platform doesn’t need to know the service interface. It only needs to know about DI requirements.

Therefore, these two reports should be separate.

We can keep the <…> → { … } syntax for inline constructors, but a file renders these parts separately, in two different keys:

[“params”]:

```
<
  :DOM *
  :value Integer
  :type Text
>
```

[“service”]:

```
{
  size: (Text) -> (Integer)
}
```
