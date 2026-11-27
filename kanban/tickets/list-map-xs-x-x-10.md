---
created: 2026-11-26
---
# List.map(xs) (x) { x * 10 } - not super pretty

Possible solution:

Always require the lambda arrow. This connects the args to the function body.

(args) { body } // out
(args) -> { body } // correct

So the title case becomes: List.map(xs) (x) -> x * 10 // or { x * 10 }

Does that read better? I think so. I'd switch over to vbars if they weren't needed for type union.

Discuss.
