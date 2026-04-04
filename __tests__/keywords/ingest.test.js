import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// ingest — keyword placeholder
//
// `ingest` lets a supertype pause its declaration block, wait for the
// subtype's declaration to complete, and receive the subtype's return value.
//
// See constructors/ingest.test.js for comprehensive tests.
// See keywords/ingest.md for documentation.
// ═══════════════════════════════════════════════════════════════════════════════

describe('ingest — keyword basics', () => {
  it.todo('ingest keyword compiles in a constructor body');
  it.todo('ingest without a default cannot be constructed directly');
  it.todo('ingest with a default allows direct construction');
  it.todo('ingest with typed binding checks subtype return type');
});
