---
status: inbox
created: 2026-11-02
---
# Define what a failed file construction does

- **Problem:** a failure while constructing a file has no defined result. JS rejects the spawn and Erlang's router times out; Rust's test also fails, but I

    didn't confirm how.

- **Decision needed:** this is a language question, not a bug fix, because no call is open to report to. A #new on a file might reply with ex, while a

    top-level start has no one to tell. 

- **Depends on:** “**Constructor blocks bind cells the way handlers do**” [https://trello.com/c/TufXPcSp/265-constructor-blocks-bind-cells-the-way-handlers-do](https://trello.com/c/TufXPcSp/265-constructor-blocks-bind-cells-the-way-handlers-do "smartCard-inline")  makes this reachable in many more programs, because as in a file's block starts failing at runtime. Decide this before or alongside

    it, and ship the two together.
