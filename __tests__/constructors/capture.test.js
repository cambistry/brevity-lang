import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// capture — supertype receives subtype declaration result
//
// A supertype uses `capture` in its declaration body to pause initialization
// and receive the return value of the subtype's declaration block.
//
// See keywords/capture.md for full documentation.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Compilation ──────────────────────────────────────────────────────────────

describe('capture — compilation', () => {
  it.todo('supertype with capture compiles');
  it.todo('subtype providing capture value compiles');
  it.todo('typed capture with matching subtype return compiles');
  it.todo('typed capture with mismatched subtype return is a compiler error');
  it.todo('capture without subtype return compiles (null)');
  it.todo('chained capture across three levels compiles');
});

// ── Runtime: basic capture ───────────────────────────────────────────────────

describe('capture — basic — runtime', () => {
  it.todo('supertype receives subtype declaration return value');
  it.todo('captured value is accessible in supertype handlers');
  it.todo('capture with no subtype return yields null');
});

// ── Runtime: typed capture ───────────────────────────────────────────────────

describe('capture — typed — runtime', () => {
  it.todo('typed capture binds value with correct type');
  it.todo('capture value usable in expressions');
});

// ── Runtime: capture with constructor params ─────────────────────────────────

describe('capture — with params — runtime', () => {
  it.todo('supertype params and capture coexist');
  it.todo('subtype can use inherited params in its declaration return');
});

// ── Runtime: chained capture ─────────────────────────────────────────────────

describe('capture — chained — runtime', () => {
  it.todo('two-level capture: A captures from B, B captures from C');
  it.todo('each level receives its direct child\'s return, not grandchild');
});

// ── Runtime: capture with handlers ───────────────────────────────────────────

describe('capture — with handlers — runtime', () => {
  it.todo('captured value available alongside inherited handlers');
  it.todo('subtype can override handlers and still provide capture value');
});
