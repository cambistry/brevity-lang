import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Private functions (#)
//
// #name = { body }   — private, accessible only within the defining scope
// ═══════════════════════════════════════════════════════════════════════════════

// ── Compilation ──────────────────────────────────────────────────────────────

describe('private functions — compilation', () => {
  it('file-level private function compiles', () => {
    expect(() => compileSource(`
      #secret = { 42 }
      @test = -> result: #secret() as Integer
    `)).not.toThrow();
  });

  it('private function inside named type compiles', () => {
    expect(() => compileSource(`
      T = <> { #x = { 1 }; @a = -> result: #x() as Integer }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('private function inside non-constructor function compiles', () => {
    expect(() => compileSource(`
      @test = {
        #value = { "ten" }
        -> result: #value() as Text
      }
    `)).not.toThrow();
  });
});

// ── Runtime: file-level actor ────────────────────────────────────────────────

describe('private functions — file-level actor — runtime', () => {
  const script = `
    #secret = { 42 }
    #greeting = { "hello" }

    @testSecret = -> result: #secret() as Integer

    @testGreeting = -> result: #greeting() as Text

    @testCompose = -> result: (#secret() + 8) as Integer
  `;

  it('file-level private returns value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testSecret', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('file-level private returns text', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testGreeting', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' } },
    );
  });

  it('file-level private used in expression', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testCompose', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 50 }, to: 'c' } },
    );
  });
});

// ── Runtime: named type ──────────────────────────────────────────────────────

describe('private functions — named type — runtime', () => {
  const script = `
    T = <> {
      #x = { 10 }
      #y = { 20 }
      @sum = -> result: (#x() + #y()) as Integer
    }

    @test
      =
      t = T()
      :result = t.sum()
      -> :result as Integer
  `;

  it('private functions within type are callable by public functions', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 30 }, to: 'c' } },
    );
  });
});

// ── Runtime: inside non-constructor function ─────────────────────────────────

describe('private functions — inside function — runtime', () => {
  const script = `
    @testLocal = {
      #value = { "ten" }
      -> result: #value() as Text
    }

    @testLocalCompose = {
      #a = { 3 }
      #b = { 7 }
      -> result: (#a() + #b()) as Integer
    }
  `;

  it('private function scoped inside handler', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testLocal', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'ten' }, to: 'c' } },
    );
  });

  it('multiple private functions compose inside handler', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testLocalCompose', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });
});
