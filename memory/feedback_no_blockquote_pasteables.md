---
name: feedback-no-blockquote-pasteables
description: "Never wrap text meant for copy/paste (tickets, messages) in markdown `>` blockquotes; use a fenced code block"
metadata:
  node_type: memory
  type: feedback
  originSessionId: f6ef02ca-41d6-437a-ae71-2f3c97508ed4
  modified: 2026-11-13T15:55:08.565Z
---

Text the user will copy and paste (a ticket description, a commit message, a message to send) goes in a fenced code block, never in `>` blockquote lines.

**Why:** the `>` markers come along when the user copies, so every line has to be cleaned up by hand — "makes cut and paste a real pain" (2026-11-13).

**How to apply:** put pasteable text in a ``` block with no per-line prefixes. Applies to tickets especially; see [[feedback-tickets]].
