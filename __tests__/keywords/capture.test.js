import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// capture — keyword placeholder
//
// `capture` lets a supertype pause its declaration block, wait for the
// subtype's declaration to complete, and receive the subtype's return value.
//
// See constructors/capture.test.js for comprehensive tests.
// See keywords/capture.md for documentation.
// ═══════════════════════════════════════════════════════════════════════════════

describe('capture — keyword basics', () => {
  it.todo('capture keyword compiles in a constructor body');
  it.todo('capture without a subtype return produces null');
  it.todo('capture with typed binding checks subtype return type');
});
