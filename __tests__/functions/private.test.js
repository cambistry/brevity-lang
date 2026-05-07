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
      @test = -> result: #secret()
    `)).not.toThrow();
  });

  it('private function inside named class compiles', () => {
    expect(() => compileSource(`
      T = * { #x = { 1 }; @a = -> result: #x() }
      @test = -> 1
    `)).not.toThrow();
  });

  it('private function inside non-constructor function compiles', () => {
    expect(() => compileSource(`
      @test = {
        #value = { "ten" }
        -> result: (#value() + "") as Text
      }
    `)).not.toThrow();
  });
});

// ── Runtime: file-level actor ────────────────────────────────────────────────

describe('private functions — file-level actor — runtime', () => {
  const script = `
    #secret = -> result: 42
    #greeting = -> result: "hello"

    @testSecret = {
      result: Integer = #secret()
      -> :result
    }

    @testGreeting = {
      result: Text = #greeting()
      -> :result
    }

    @testCompose = {
      result: Integer = #secret()
      -> result: (result + 8)
    }
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

// ── Runtime: named class ─────────────────────────────────────────────────────

describe('private functions — named class — runtime', () => {
  const script = `
    T = * {
      #x = { 10 }
      #y = { 20 }
      @sum = -> result: (#x() + #y()) as Integer
    }

    @test
      =
      t = T()
      :result Integer = t.sum()
      -> :result
  `;

  it('private functions within type are callable by public functions', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 30 }, to: 'c' } },
    );
  });
});

// ── Forward references ────────────────────────────────────────────────────────

describe('private functions — forward references', () => {
  it('handler before private function definition compiles', () => {
    expect(() => compileSource(`
      @test = -> result: #helper()
      #helper = { 42 }
    `)).not.toThrow();
  });

  const script = `
    @testForward = {
      result: Integer = #helper()
      -> :result
    }

    #helper = -> result: 42

    @testChained = {
      result: Integer = #step1()
      -> :result
    }

    #step1 = {
      result: Integer = #step2()
      -> result: (result + 1)
    }

    #step2 = -> result: 6
  `;

  it('public handler calls #fn defined after it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testForward', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('#fn calls another #fn defined after it', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testChained', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });
});

// ── Runtime: inside non-constructor function ─────────────────────────────────

describe('private functions — inside function — runtime', () => {
  const script = `
    @testLocal = {
      #value = { "ten" }
      -> result: (#value() + "") as Text
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

// ── Lineal forms ─────────────────────────────────────────────────────────────

describe('private functions — lineal forms', () => {
  it('#fn\\n=\\nbody. (parameterless lineal)', async () => {
    await expectBehavior(`
      #answer
        =
        -> result: 42

      @test
        =
        :result Integer = #answer()
        -> :result
    `,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('#fn\\n=\\nparams\\n=\\nbody. (lineal with params)', async () => {
    await expectBehavior(`
      #double
        =
        n Integer
        =
        -> result: (n * 2)

      @test
        =
        :result Integer = #double(7)
        -> :result
    `,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 14 }, to: 'c' } },
    );
  });

  it('#fn = body (same-line) still works', () => {
    expect(() => compileSource(`
      #answer = -> result: 42
      @test = -> result: #answer()
    `)).not.toThrow();
  });

  it('#fn\\n<...> (private constructor) is a parse error', () => {
    expect(() => compileSource(`
      #thing = <value Integer> {
        @get = -> :value
      }
      @test = -> 1
    `)).toThrow(/private functions cannot be constructors/);
  });
});
