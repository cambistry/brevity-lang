import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// ingest — supertype receives subtype declaration result
//
// A supertype uses `ingest` in its declaration body to pause initialization
// and receive the return value of the subtype's declaration block.
//
// See keywords/ingest.md for full documentation.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Compilation ──────────────────────────────────────────────────────────────

describe('ingest — compilation', () => {
  it.todo('supertype with ingest compiles');
  it.todo('subtype providing ingest value compiles');
  it.todo('typed ingest with matching subtype return compiles');
  it.todo('typed ingest with mismatched subtype return is a compiler error');
  it.todo('ingest without default — direct construction is a compiler error');
  it.todo('ingest with default — direct construction compiles');
  it.todo('multi-level: type ingests and provides independently');
});

// ── Runtime: basic ingest ────────────────────────────────────────────────────

describe('ingest — basic — runtime', () => {
  it.todo('supertype receives subtype declaration return value');
  it.todo('ingested value is accessible in supertype handlers');
  it.todo('inline subtype form: <<Base>> -> "value"');
});

// ── Runtime: ingest with default ─────────────────────────────────────────────

describe('ingest — with default — runtime', () => {
  it.todo('direct construction uses default value');
  it.todo('subtype overrides default value');
});

// ── Runtime: typed ingest ────────────────────────────────────────────────────

describe('ingest — typed — runtime', () => {
  it.todo('typed ingest binds value with correct type');
  it.todo('ingest value usable in expressions');
});

// ── Runtime: ingest with constructor params ──────────────────────────────────

describe('ingest — with params — runtime', () => {
  it.todo('supertype params and ingest coexist');
  it.todo('subtype can use inherited params in its declaration return');
});

// ── Runtime: multi-level ingest ──────────────────────────────────────────────

describe('ingest — multi-level — runtime', () => {
  it.todo('type that ingests and provides to its own supertype independently');
  it.todo('each ingest receives from direct child only');
});

// ── Runtime: ingest with handlers ────────────────────────────────────────────

describe('ingest — with handlers — runtime', () => {
  it.todo('ingested value available alongside inherited handlers');
  it.todo('subtype can override handlers and still provide ingest value');
});
