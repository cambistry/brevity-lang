import { compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// HTML.Element / HTML.Aria / HTML.Div — manifest-hosted subtype discipline
//
// These are compile-time tests: compileSource runs through the validator on
// every target, so the discipline applied here doesn't depend on the runtime
// implementation of the typed constructors (that lands in a follow-up).
//
// HTML hosts an abstract `Element` parent (every non-event-handler global
// attribute) and an `Aria` bucket (the ARIA states/properties grouped as
// one cohesive sub-type so Element's surface stays manageable). `Div` is
// the first concrete tag — empty body since `<div>` adds no own attributes.
//
// The manifest used here is a TRIMMED version of the real one in
// src/codegen/browser/runtime.js. Each typed family (Bool / Integer /
// Decimal / Text / Aria / Structure) is represented; covering the full
// 70-attribute surface adds nothing — the validator's discipline is the
// same for one Bool param as for ten.
// ═══════════════════════════════════════════════════════════════════════════════

const HTML_MANIFEST = `{
  Element: <
    :id Text | null,
    :class Text | null,
    :hidden Boolean | null,
    :tabindex Integer | null,
    :data Structure | null,
    :aria Aria | null
  >

  Aria: <
    :label Text | null,
    :level Integer | null,
    :hidden Boolean | null,
    :valuenow Decimal | null
  >

  Div: <Element |>
}`;

const compileWithHTML = (src) =>
  compileSource(src, { remotes: [{ path: 'HTML', service: HTML_MANIFEST }] });

// ── Happy path ───────────────────────────────────────────────────────────────

describe('HTML element manifest — happy path', () => {
  it('Div() with no args (all params nullable)', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Div)>
      @test = { d Div = HTML.Div() . }
    `)).not.toThrow();
  });

  it('Div(:id Text) — inherited Text attr', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Div)>
      @test = { d Div = HTML.Div(id: "header") . }
    `)).not.toThrow();
  });

  it('Div(:hidden Bool) — inherited Bool attr', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Div)>
      @test = { d Div = HTML.Div(hidden: true) . }
    `)).not.toThrow();
  });

  it('Div(:tabindex Integer) — inherited Integer attr', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Div)>
      @test = { d Div = HTML.Div(tabindex: 0) . }
    `)).not.toThrow();
  });

  it('Div(:aria Aria) — bucketed nested constructor', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Div, :Aria)>
      @test = {
        a Aria = HTML.Aria(label: "Close")
        d Div = HTML.Div(aria: a)
        .
      }
    `)).not.toThrow();
  });

  it('Div with multiple inherited attrs at once', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Div)>
      @test = { d Div = HTML.Div(id: "x", hidden: true, tabindex: 1) . }
    `)).not.toThrow();
  });

  it('Aria(:level Integer) — own attr on bucketed type', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Aria)>
      @test = { a Aria = HTML.Aria(level: 2) . }
    `)).not.toThrow();
  });

  it('Aria(:valuenow Decimal) — Decimal attr', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Aria)>
      @test = { a Aria = HTML.Aria(valuenow: 0.5) . }
    `)).not.toThrow();
  });
});

// ── Sad path: type mismatch on inherited attrs ───────────────────────────────

describe('HTML element manifest — type mismatches (sad path)', () => {
  it('Div(:hidden Text) is rejected — expects Boolean', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Div)>
      @test = { d Div = HTML.Div(hidden: "true") . }
    `)).toThrow(/named arg 'hidden'.*(Boolean.*Text|Text.*Boolean)/);
  });

  it('Div(:tabindex Text) is rejected — expects Integer', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Div)>
      @test = { d Div = HTML.Div(tabindex: "1") . }
    `)).toThrow(/named arg 'tabindex'.*(Integer.*Text|Text.*Integer)/);
  });

  it('Aria(:level Text) is rejected — expects Integer', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Aria)>
      @test = { a Aria = HTML.Aria(level: "high") . }
    `)).toThrow(/named arg 'level'.*(Integer.*Text|Text.*Integer)/);
  });

  it('Div(:aria Text) is rejected — expects Aria', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Div)>
      @test = { d Div = HTML.Div(aria: "Close") . }
    `)).toThrow(/named arg 'aria'.*(Aria.*Text|Text.*Aria)/);
  });
});

// ── Sad path: unknown attribute ──────────────────────────────────────────────

describe('HTML element manifest — unknown attrs (sad path)', () => {
  it("Div(:nope ...) is rejected — :nope is not on Element", () => {
    expect(() => compileWithHTML(`
      <HTML: (:Div)>
      @test = { d Div = HTML.Div(nope: "x") . }
    `)).toThrow(/unexpected: nope/);
  });

  it('Div(:label ...) is rejected — :label belongs on Aria, not Element', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Div)>
      @test = { d Div = HTML.Div(label: "Close") . }
    `)).toThrow(/unexpected: label/);
  });
});

// ── Sad path: unknown type at the call site ──────────────────────────────────

describe('HTML element manifest — unknown call target (sad path)', () => {
  it("HTML.Span() is rejected — Span isn't declared", () => {
    expect(() => compileWithHTML(`
      <HTML: (:Div)>
      @test = { d Div = HTML.Span() . }
    `)).toThrow(/has no function 'Span'/);
  });
});
