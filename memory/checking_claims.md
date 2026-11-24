---
name: checking-claims
description: How to check Brevity syntax and design claims before making them — verify forms in docs/tests, don't trust note examples, newest note wins
metadata:
  type: feedback
---

- **Assume an unfamiliar shape already exists.** Before calling a shape new or proposing one, check `LANGUAGE_OVERVIEW.md`, `LANGUAGE_FEATURES.md` and `__tests__/`, and read one test that uses it. Inventing "new forms" for existing ones has derailed design talks repeatedly.
- **A note's example isn't proof.** Check a form against tests and generated code before recommending it.
- **Notes are dated, and the newest wins.** A note's head says what it supersedes. Before relying on a note, grep `notes/` for later notes on the same topic. Never answer design questions from memory.
- **Design rules live in notes/, not here.** When a correction is about the language, update or add a note; when it's about how I work, add it to a memory file.
