---
status: done
created: 2026-04-22
---
# Switch to <<...>> for addresses in CAM messages.

Retain backticks in BV code.

Literal < and > does not require escaping. Literal << and >> escape with bracketing backslashes:

```
`\<\` -> <    // these shouldn't be generated,
`\>\` -> >    // but are understood
`\<<\` -> <<
`\>>\` -> >>
`\<<<\` -> <<<
`\>>>\` -> >>>

etc.
```
