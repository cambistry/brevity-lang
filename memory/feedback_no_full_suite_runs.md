---
name: no-full-suite-runs
description: "Full suite runs are fine during dev (`npm run test`, browser not needed); report full green and wait for acceptance before committing, except in user-declared self-supervised multi-ticket runs: green > commit > continue"
metadata:
  node_type: memory
  type: feedback
  originSessionId: f40d26ae-367d-4597-9bf1-6989466e20d9
  modified: 2026-11-19T19:14:23.422Z
---

Full test runs are fine during development (2026-11-19). The go-to is `npm run test` (js, erlang, rust, dom). There's no need to run the `browser` project every time; add it only when the change touches browser code.

**Normal flow:** finish the change, smoke-test with a full `--selectProjects=js` run first (whole js project, not one file), then run the full suite, and report the full green result. Then wait for the user's acceptance before committing.

**Self-supervised flow:** applies when the user has queued several tickets for me to work through on my own and has said I'm self-supervising. Then for each ticket: green, commit, continue to the next. Don't wait for acceptance between tickets. Without that explicit indication, the normal flow applies.

**One ticket at a time, always (2026-11-19):** when several tickets arrive together (even "1. … 2. …" in one message), finish ticket 1 → full `npm run test` green → commit → only then start ticket 2. Never stack two tickets in one working tree. I slipped on this with the spawn + emit/on pair; the user: "You should do a full suite run in between each ticket before committing… I think this was already discussed."

**Why:** the full suite now runs in about 3 minutes (it used to be 5–7+). A full run at the end catches cross-target failures that scoped js runs miss: an Erlang-only `Self_fn` failure reached the user on 2026-11-19 that way.

**How to apply:**
- Before the full suite, do a full js run as a smoke test, especially when the change is mostly parsing/AST (target-independent); go to `npm run test` once js is green (2026-11-19).
- Scoped runs are still fine for quick iteration. Use a full run before reporting done.
- Report faithfully. Fix every failure, never skip or exclude a test to get green ([[feedback_no_target_guards]]).
- One run at a time, never concurrent ([[feedback-no-parallel-test-runs]]). If the user says they're running the suite, don't start one (2026-11-19: "I am doing that. Don't").
- Commits otherwise follow [[no-unasked-commits]] and [[commit-means-commit]].

**Pitfall:** `--selectProjects` takes several values, so a test path placed right after it is read as a project name and the whole suite runs. Use `--selectProjects=js` or put another flag between them ([[feedback_jest_select_projects]]).
