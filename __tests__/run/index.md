# Run Smoke Tests

LLM orientation: this directory verifies that emitted JavaScript can be executed
by the test runner.

## Tested Behavior

- An empty script produces output that runs without error.
- Malformed JavaScript throws, proving the runner is actually executing code.

This is infrastructure coverage, not source-language syntax guidance.
