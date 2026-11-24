---
status: done
created: 2026-11-02
---
# Type values can't cross to or from a class in another file

**Problem:** Scalars pass correctly to and from a class made by #new, but Type values don't, because the receiver needs a ty tag to decode them. There are two separate gaps.

**1. Replies, on Rust and Erlang**

```brevity
// svc.bv
::Point (x Integer, y Integer)

@W = *{
  @get = { return Point(1, 2) }
}
```

```brevity
// caller
w = Svc.W()
p = w.get()      // the reply arrives untagged, so the caller can't decode a Point
```

A class's dispatch arms don't pass bv-a up to their parent in process, so the reply goes out without it. JS is unaffected, because its replies carry the tag.

**2. Constructor arguments, on all targets**

```brevity
w = Svc.W(Point(1, 2))   // #new carries no tags, so the receiver has nothing to decode by
```

Other ops with a payload must carry ty or are refused as schema_required, but #new has never carried one and isn't gated this way. The caller's arguments are only checked against the doc at compile time, so the receiver has no check of its own.

**To decide:** Should #new carry ty and be gated like other ops? That closes the gap and gives the receiver a real check. However, all existing construction would then need tags, including DOM #new in the browser runtime. The alternative is to send tags only when an argument needs them, which leaves scalar construction as it is but makes #new a special case.

**Done when:**

- A Type value returned from a constructed class decodes in the caller on JS, Rust and Erlang.
- A Type value passed as a constructor argument decodes in the class on all three.
- Tests cover both directions through two compiled files, using the relay in __tests__/classes/public_class_across_files.test.js.
- The "Known gaps" entries in notes/session-2026-11-01-public-classes-across-files.md are updated.
