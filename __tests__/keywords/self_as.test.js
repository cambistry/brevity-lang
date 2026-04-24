import { expectBehavior, compileSource } from '../helpers.js';

describe('self-as clauses', () => {
  const script = `
    One
      <>
      =
      self as Integer = -> 1
      self as Text = -> "one"
      self as Boolean = -> true
      @ping = -> pong: "ok" as Text
      .
    end#One

    Multi
      <>
      =
      self as Integer = -> 42
      self as Text = -> "forty-two"
      self as Boolean = -> false
      @ping = -> pong: "ok" as Text
      .
    end#Multi

    Greeter
      <>
      =
      self as Integer = -> 99
      @hello = -> answer: "world" as Text
      .
    end#Greeter

    Wrapper
      <>
      =
      self as !Wrapper = -> 0
      @ping = -> pong: "ok" as Text
      .
    end#Wrapper

    WrapperText
      <>
      =
      self as !WrapperText = -> "default"
      @ping = -> pong: "ok" as Text
      .
    end#WrapperText

    OneTwoLine
      <>
      =
      self as Integer
        =
        -> 1
      @ping = -> pong: "ok" as Text
      .
    end#OneTwoLine

    Dual
      <>
      =
      self as Integer = -> 7
      @greet = -> msg: "hi" as Text
      .
    end#Dual

    @asInt
      =
      w Integer = One()
      -> w as Integer
    @asText
      =
      t Text = One()
      -> t as Text
    @asBool
      =
      b Boolean = One()
      -> b as Boolean
    @multiCast
      =
      n Integer = Multi()
      t Text = Multi()
      b Boolean = Multi()
      -> n: n as Integer, t: t as Text, b: b as Boolean

    @untypedRef
      =
      g = Greeter!()
      :answer = g.hello()
      -> :answer as Text

    @negatedInt
      =
      n Integer = Wrapper()
      -> n as Integer
    @negatedText
      =
      t Text = WrapperText()
      -> t as Text
    @twoLineForm
      =
      w Integer = OneTwoLine()
      -> w as Integer
    @dualCoexist
      =
      n Integer = Dual()
      d = Dual!()
      :msg = d.greet()
      -> n: n as Integer, msg: msg as Text
  `;

  it('self as Integer — literal cast', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@asInt', from: 'c' } }, { output: { id: '1', 'bv-a': ['Integer'], re: [1], to: 'c' } });
  });

  it('self as Text — literal cast', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@asText', from: 'c' } }, { output: { id: '2', 'bv-a': ['Text'], re: ['one'], to: 'c' } });
  });

  it('self as Boolean — literal cast', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@asBool', from: 'c' } }, { output: { id: '3', 'bv-a': ['Boolean'], re: [true], to: 'c' } });
  });

  it('multiple self-as clauses — correct one selected by target type', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@multiCast', from: 'c' } },
      { output: { id: '4', 'bv-a': { n: 'Integer', t: 'Text', b: 'Boolean' }, re: { n: 42, t: 'forty-two', b: false }, to: 'c' } },
    );
  });

  it('untyped assignment — no cast, still works via ref', async () => {
    await expectBehavior(script, { input: { id: '5', op: '@untypedRef', from: 'c' } }, { output: { id: '5', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' } });
  });

  it('negated catch-all — as !Self (Integer target)', async () => {
    await expectBehavior(script, { input: { id: '6', op: '@negatedInt', from: 'c' } }, { output: { id: '6', 'bv-a': ['Integer'], re: [0], to: 'c' } });
  });

  it('negated catch-all — as !Self (Text target)', async () => {
    await expectBehavior(script, { input: { id: '7', op: '@negatedText', from: 'c' } }, { output: { id: '7', 'bv-a': ['Text'], re: ['default'], to: 'c' } });
  });

  it('self-as clause — two-line form', async () => {
    await expectBehavior(script, { input: { id: '8', op: '@twoLineForm', from: 'c' } }, { output: { id: '8', 'bv-a': ['Integer'], re: [1], to: 'c' } });
  });

  it('actor with both as clauses and public functions coexist', async () => {
    await expectBehavior(script,
      { input: { id: '9', op: '@dualCoexist', from: 'c' } },
      { output: { id: '9', 'bv-a': { n: 'Integer', msg: 'Text' }, re: { n: 7, msg: 'hi' }, to: 'c' } },
    );
  });
});

// ── CAM message protocol: [Type, "as"] op ───────────────────────────────────

describe('self as — CAM message (file-level actor)', () => {
  const script = `
    self as Integer = -> 42
    @ping = -> pong: "ok" as Text
  `;

  it('as Integer — file-level actor responds to [Integer, as] op', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: ['Integer', 'as'], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [42], to: 'c' } },
    );
  });

  it('public handler still works alongside as clause', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@ping', from: 'c' } },
      { output: { id: '2', 'bv-a': { pong: 'Text' }, re: { pong: 'ok' }, to: 'c' } },
    );
  });
});

describe('self as — CAM message (file-level, multiple clauses)', () => {
  const script = `
    self as Integer = -> 42
    self as Text = -> "forty-two"
    self as Boolean = -> false
    @ping = -> pong: "ok" as Text
  `;

  it('as Integer', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: ['Integer', 'as'], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [42], to: 'c' } },
    );
  });

  it('as Text', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: ['Text', 'as'], from: 'c' } },
      { output: { id: '2', 'bv-a': ['Text'], re: ['forty-two'], to: 'c' } },
    );
  });

  it('as Boolean', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: ['Boolean', 'as'], from: 'c' } },
      { output: { id: '3', 'bv-a': ['Boolean'], re: [false], to: 'c' } },
    );
  });
});

describe('self as — CAM message (file-level, negated catch-all)', () => {
  const script = `
    self as !Self = -> 0
    @ping = -> pong: "ok" as Text
  `;

  it('negated catch-all responds to any type', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: ['Integer', 'as'], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [0], to: 'c' } },
    );
  });

  it('negated catch-all responds to Text', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: ['Text', 'as'], from: 'c' } },
      { output: { id: '2', 'bv-a': ['Text'], re: [0], to: 'c' } },
    );
  });
});

describe('self as — CAM message (two-step: ref then typed assign)', () => {
  const script = `
    C = <> {
      self as Integer = -> 42
      self as Text = -> "forty-two"
      @ping = -> pong: "ok" as Text
    }

    @asInt
      =
      c = C()
      n Integer = c
      -> n as Integer

    @asText
      =
      c = C()
      t Text = c
      -> t as Text
  `;

  it('typed assign from ref sends [Integer, as] message', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@asInt', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [42], to: 'c' } },
    );
  });

  it('typed assign from ref sends [Text, as] message', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@asText', from: 'c' } },
      { output: { id: '2', 'bv-a': ['Text'], re: ['forty-two'], to: 'c' } },
    );
  });
});

describe('self as — compile errors', () => {
  it('no matching self-as clause → compile-time error', () => {
    expect(() => compileSource(`
      One
        <>
        =
        self as Integer = -> 1
        self as Text = -> "one"
        @ping = -> pong: "ok" as Text
        .

      @test
        =
        d Decimal = One()
        -> d as Decimal
    `)).toThrow(/No matching 'self-as' clause in actor 'One' for type 'Decimal'/);
  });
});
