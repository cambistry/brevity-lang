---
name: feedback-notes-no-git-state
description: "notes/ documents design discussions and decisions only, not a progress log; never record git state, task status, or what was done in a session"
metadata:
  node_type: memory
  type: feedback
  originSessionId: e49f16c5-314a-404a-95f3-18322699a293
  modified: 2026-11-10T05:53:03.338Z
---

`notes/` exists to document design discussions and decisions. It is not a personal progress log.

Keep out of notes:
- git state: committed, uncommitted, staged, "keep or delete this dir"
- task status and to-do lists
- narration of what was done in a session

**Why:** The user said (2026-11-09) "You have frankly adopted notes/ as some kind of personal progress log. That's not its purpose." That followed a note's "Not committed" section going stale one commit later, which they called "way beneath a note concern."

**How to apply:** Write the design: the options, the decision and its reasons, and the open design questions. Report progress and repo status in chat. Related: [[feedback-design-notes-location]].
