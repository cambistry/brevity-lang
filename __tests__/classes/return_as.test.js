import { expectBehavior, expectActorBehavior, createActor, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Constructor block implicit return-as — compilation
// ═══════════════════════════════════════════════════════════════════════════════

describe('return-as — compilation', () => {
  it('bare trailing string in braced constructor block', () => {
    expect(() => compileSource(`
      C = * {
        @fn = -> value: 123 as Integer
        "string"
      }
      @test
        =
        t Text = C()
        return t as Text
    `)).not.toThrow();
  });

  it('explicit → form with as Type', () => {
    expect(() => compileSource(`
      Double = (input Integer) *{
        @original = -> value: input as Integer
        return (input * 2) as Integer
      }
      @test
        =
        d Integer = Double(100)
        return d as Integer
    `)).not.toThrow();
  });

  it('bare trailing integer literal', () => {
    expect(() => compileSource(`
      C = * {
        42
      }
      @test
        =
        n Integer = C()
        return n as Integer
    `)).not.toThrow();
  });

  it('bare trailing boolean literal', () => {
    expect(() => compileSource(`
      C = * {
        true
      }
      @test
        =
        b Boolean = C()
        return b as Boolean
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Service block implicit return-as — runtime
// ═══════════════════════════════════════════════════════════════════════════════

describe('return-as — runtime (bare trailing expression)', () => {
  const script = `
    C = * {
      @fn = -> value: 123 as Integer
      "string"
    }

    @asText
      =
      t Text = C()
      return t as Text

    @handlerStillWorks
      =
      c = C()
      :value = c.fn()
      return :value as Integer
  `;

  it('typed assign extracts memoized return-as value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@asText', from: 'c' } },
      { output: { id: '1', 'ty': ['Text'], re: ['string'], to: 'c' } },
    );
  });

  it('public handler coexists with return-as', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@handlerStillWorks', from: 'c' } },
      { output: { id: '2', 'ty': { value: 'Integer' }, re: { value: 123 }, to: 'c' } },
    );
  });
});

describe('return-as — runtime (explicit → with as Type)', () => {
  const script = `
    Double = (input Integer) *{
      @original = -> value: input as Integer
      return (input * 2) as Integer
    }

    @getDouble
      =
      d Integer = Double(100)
      return d as Integer

    @getOriginal
      =
      d = Double(50)
      :value = d.original()
      return :value as Integer
  `;

  it('return-as with constructor param expression', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@getDouble', from: 'c' } },
      { output: { id: '1', 'ty': ['Integer'], re: [200], to: 'c' } },
    );
  });

  it('handler still works on actor with return-as', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@getOriginal', from: 'c' } },
      { output: { id: '2', 'ty': { value: 'Integer' }, re: { value: 50 }, to: 'c' } },
    );
  });
});

describe('return-as — runtime (integer literal)', () => {
  const script = `
    C = * {
      42
    }

    @test
      =
      n Integer = C()
      return n as Integer
  `;

  it('bare integer return-as', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'ty': ['Integer'], re: [42], to: 'c' } },
    );
  });
});

describe('return-as — runtime (boolean literal)', () => {
  const script = `
    C = * {
      true
    }

    @test
      =
      b Boolean = C()
      return b as Boolean
  `;

  it('bare boolean return-as', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'ty': ['Boolean'], re: [true], to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CAM message protocol: [Type, "as"] op for return-as
// ═══════════════════════════════════════════════════════════════════════════════

describe('return-as — CAM [Type, as] message (file-level actor)', () => {
  const script = `
    @fn = -> value: 123 as Integer
    "string"
  `;

  it('responds to [Text, as] op', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: ['Text', 'as'], from: 'c' } },
      { output: { id: '1', 'ty': ['Text'], re: ['string'], to: 'c' } },
    );
  });

  it('public handler still works alongside return-as', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@fn', from: 'c' } },
      { output: { id: '2', 'ty': { value: 'Integer' }, re: { value: 123 }, to: 'c' } },
    );
  });
});

describe('return-as — file-level integer', () => {
  const script = `
    @ping = -> pong: "ok" as Text
    42
  `;

  it('responds to [Integer, as] op', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: ['Integer', 'as'], from: 'c' } },
      { output: { id: '1', 'ty': ['Integer'], re: [42], to: 'c' } },
    );
  });
});

describe('return-as — file-level boolean', () => {
  const script = `
    @ping = -> pong: "ok" as Text
    true
  `;

  it('responds to [Boolean, as] op', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: ['Boolean', 'as'], from: 'c' } },
      { output: { id: '1', 'ty': ['Boolean'], re: [true], to: 'c' } },
    );
  });

  it('handler coexists', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@ping', from: 'c' } },
      { output: { id: '2', 'ty': { pong: 'Text' }, re: { pong: 'ok' }, to: 'c' } },
    );
  });
});

describe('return-as — file-level with explicit → and as Type', () => {
  const script = `
    @ping = -> pong: "ok" as Text
    return 99 as Integer
  `;

  it('responds to [Integer, as] op', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: ['Integer', 'as'], from: 'c' } },
      { output: { id: '1', 'ty': ['Integer'], re: [99], to: 'c' } },
    );
  });
});

describe('return-as — file-level with constructor param expression', () => {
  it('responds to [Integer, as] with computed value', async () => {
    const actor = await createActor(`
      *
        factor: Integer
      *

      @raw = -> value: factor as Integer
      return (factor * 3) as Integer
    `, { constructorArgs: { factor: 10 } });

    await expectActorBehavior(actor,
      { input: { id: '1', op: ['Integer', 'as'], from: 'c' } },
      { output: { id: '1', 'ty': ['Integer'], re: [30], to: 'c' } },
    );
  });

  it('handler still accesses constructor param', async () => {
    const actor = await createActor(`
      *
        factor: Integer
      *

      @raw = -> value: factor as Integer
      return (factor * 3) as Integer
    `, { constructorArgs: { factor: 10 } });

    await expectActorBehavior(actor,
      { input: { id: '1', op: '@raw', from: 'c' } },
      { output: { id: '1', 'ty': { value: 'Integer' }, re: { value: 10 }, to: 'c' } },
    );
  });
});

describe('return-as — coexists with explicit self-as clause', () => {
  const script = `
    self as Boolean = -> true
    @ping = -> pong: "ok" as Text
    "hello"
  `;

  it('return-as responds to [Text, as]', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: ['Text', 'as'], from: 'c' } },
      { output: { id: '1', 'ty': ['Text'], re: ['hello'], to: 'c' } },
    );
  });

  it('explicit self-as responds to [Boolean, as]', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: ['Boolean', 'as'], from: 'c' } },
      { output: { id: '2', 'ty': ['Boolean'], re: [true], to: 'c' } },
    );
  });

  it('handler still works', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@ping', from: 'c' } },
      { output: { id: '3', 'ty': { pong: 'Text' }, re: { pong: 'ok' }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Lineal form — explicit → required
// ═══════════════════════════════════════════════════════════════════════════════

describe('return-as — lineal form', () => {
  const script = `
    Double =
      *
        input Integer
      *
      @original = -> value: input as Integer
      return (input * 2) as Integer
      .

    @test
      =
      d Integer = Double(100)
      return d as Integer
  `;

  it('lineal → form with as Type', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'ty': ['Integer'], re: [200], to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Inline constructor — delimited form (braces)
// ═══════════════════════════════════════════════════════════════════════════════

describe('return-as — inline constructor delimited form', () => {
  const script = `
    Box = (value Integer) *{
      @get = -> value as Integer
      (value + 1) as Integer
    }

    @test
      =
      n Integer = Box(9)
      return n as Integer
  `;

  it('delimited bare expression with constructor param', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'ty': ['Integer'], re: [10], to: 'c' } },
    );
  });

  it('handler still works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'ty': ['Integer'], re: [10], to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// File-level — lineal form (→ required)
// ═══════════════════════════════════════════════════════════════════════════════

describe('return-as — file-level lineal form', () => {
  const script = `
    @ping = -> pong: "ok" as Text
    return "file-value" as Text
  `;

  it('file-level → responds to [Text, as]', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: ['Text', 'as'], from: 'c' } },
      { output: { id: '1', 'ty': ['Text'], re: ['file-value'], to: 'c' } },
    );
  });
});

describe('return-as — file-level lineal with constructor params', () => {
  it('file-level → with param expression', async () => {
    const actor = await createActor(`
      *
        n: Integer
      *

      @get = -> value: n as Integer
      return (n * n) as Integer
    `, { constructorArgs: { n: 7 } });

    await expectActorBehavior(actor,
      { input: { id: '1', op: ['Integer', 'as'], from: 'c' } },
      { output: { id: '1', 'ty': ['Integer'], re: [49], to: 'c' } },
    );
  });
});
