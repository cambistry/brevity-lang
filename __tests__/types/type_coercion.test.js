import { createActor, expectActorBehavior, expectBehavior, compileActor, compileSource } from '../helpers.js';

// ── Asking an actor: a typed bind sends [Type, "as"] ────────────────────────

describe('type coercion — declared in the header', () => {
  const script = `
    *
      "/services/counter": Counter {
        get () -> (count: Integer)
      } | Integer
      "/services/store": Store {
        ping. () => .
      } | Integer | Text
      "service.bv": Service () -> *{
        ping. () => .
      } | Integer | Text
    *

    @counterInt
      =
      n Integer = Counter
      return n as Integer

    @storeInt
      =
      n Integer = Store
      return n as Integer

    @storeText
      =
      t Text = Store
      return t as Text

    @serviceInt
      =
      n Integer = Service()
      return n as Integer

    @serviceText
      =
      t Text = Service()
      return t as Text
  `;

  it('service ref — sends [Integer, as] and replies with the value', async () => {
    await expectBehavior(script,
      { input: { id: '99', op: '@counterInt', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', op: ['Integer', 'as'], to: 'Counter' }) },
      { input: { id: '1', re: [42], 'ty': ['Integer'] } },
      { output: { id: '99', re: [42], 'ty': ['Integer'], to: 'caller' } },
    );
  });

  it('service ref with several as types — sends the bound type', async () => {
    await expectBehavior(script,
      { input: { id: '99', op: '@storeInt', from: 'caller' } },
      { output: expect.objectContaining({ op: ['Integer', 'as'], to: 'Store' }) },
    );
    await expectBehavior(script,
      { input: { id: '99', op: '@storeText', from: 'caller' } },
      { output: expect.objectContaining({ op: ['Text', 'as'], to: 'Store' }) },
    );
  });

  it('class ref, one step — new, then [Integer, as]', async () => {
    await expectBehavior(script,
      { input: { id: '99', op: '@serviceInt', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', op: [[], '#new'], to: 'Service' }) },
      { input: { id: '1', re: '#<Service/1>', 'ty': 'Service', from: 'Service' } },
      { output: expect.objectContaining({ id: '2', op: ['Integer', 'as'], to: 'Service/1' }) },
      { input: { id: '2', re: [42], 'ty': ['Integer'] } },
      { output: { id: '99', re: [42], 'ty': ['Integer'], to: 'caller' } },
    );
  });

  it('class ref, one step — new, then [Text, as]', async () => {
    await expectBehavior(script,
      { input: { id: '99', op: '@serviceText', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', op: [[], '#new'], to: 'Service' }) },
      { input: { id: '1', re: '#<Service/1>', 'ty': 'Service', from: 'Service' } },
      { output: expect.objectContaining({ id: '2', op: ['Text', 'as'], to: 'Service/1' }) },
      { input: { id: '2', re: ['hello'], 'ty': ['Text'] } },
      { output: { id: '99', re: ['hello'], 'ty': ['Text'], to: 'caller' } },
    );
  });
});

describe('type coercion — documents supplied through options.remotes', () => {
  const script = `
    *
      "/services/counter": Counter
      "/services/store": Store
      "service.bv": Service #
    *

    @counterInt
      =
      n Integer = Counter
      return n as Integer

    @storeInt
      =
      n Integer = Store
      return n as Integer

    @storeText
      =
      t Text = Store
      return t as Text

    @serviceInt
      =
      n Integer = Service()
      return n as Integer

    @serviceText
      =
      t Text = Service()
      return t as Text
  `;
  const remotes = [
    { path: '/services/counter', service: '{\n  get () -> (count: Integer)\n} | Integer' },
    { path: '/services/store', service: '{\n  ping. () => .\n} | Integer | Text' },
    { path: 'service.bv', params: '()', service: '{\n  ping. () => .\n} | Integer | Text' },
  ];
  const spawn = async () => (await compileActor(script, { compileOptions: { remotes } })).spawn();

  it('service ref — sends [Integer, as] and replies with the value', async () => {
    await expectActorBehavior(await spawn(),
      { input: { id: '99', op: '@counterInt', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', op: ['Integer', 'as'], to: 'Counter' }) },
      { input: { id: '1', re: [42], 'ty': ['Integer'] } },
      { output: { id: '99', re: [42], 'ty': ['Integer'], to: 'caller' } },
    );
  });

  it('service ref with several as types — sends the bound type', async () => {
    await expectActorBehavior(await spawn(),
      { input: { id: '99', op: '@storeInt', from: 'caller' } },
      { output: expect.objectContaining({ op: ['Integer', 'as'], to: 'Store' }) },
    );
    await expectActorBehavior(await spawn(),
      { input: { id: '99', op: '@storeText', from: 'caller' } },
      { output: expect.objectContaining({ op: ['Text', 'as'], to: 'Store' }) },
    );
  });

  it('class ref, one step — new, then [Integer, as]', async () => {
    await expectActorBehavior(await spawn(),
      { input: { id: '99', op: '@serviceInt', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', op: [[], '#new'], to: 'Service' }) },
      { input: { id: '1', re: '#<Service/1>', 'ty': 'Service', from: 'Service' } },
      { output: expect.objectContaining({ id: '2', op: ['Integer', 'as'], to: 'Service/1' }) },
      { input: { id: '2', re: [42], 'ty': ['Integer'] } },
      { output: { id: '99', re: [42], 'ty': ['Integer'], to: 'caller' } },
    );
  });

  it('class ref, one step — new, then [Text, as]', async () => {
    await expectActorBehavior(await spawn(),
      { input: { id: '99', op: '@serviceText', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', op: [[], '#new'], to: 'Service' }) },
      { input: { id: '1', re: '#<Service/1>', 'ty': 'Service', from: 'Service' } },
      { output: expect.objectContaining({ id: '2', op: ['Text', 'as'], to: 'Service/1' }) },
      { input: { id: '2', re: ['hello'], 'ty': ['Text'] } },
      { output: { id: '99', re: ['hello'], 'ty': ['Text'], to: 'caller' } },
    );
  });
});

describe('type coercion — class ref constructed at the top level', () => {
  const body = `
    s = Service()

    @asInt
      =
      n Integer = s
      return n as Integer
  `;
  const construct = [{ output: expect.objectContaining({ op: [[], '#new'], to: 'Service' }) }];
  const steps = [
    { input: { id: '1', re: '#<Service/1>', 'ty': 'Service', from: 'Service' } },
    { input: { id: '99', op: '@asInt', from: 'caller' } },
    { output: expect.objectContaining({ op: ['Integer', 'as'], to: 'Service/1' }) },
    { input: { id: '2', re: [42], 'ty': ['Integer'] } },
    { output: { id: '99', re: [42], 'ty': ['Integer'], to: 'caller' } },
  ];

  it('declared in the header', async () => {
    const actor = await createActor(`
      *
        "service.bv": Service () -> *{
          ping. () => .
        } | Integer
      *
      ${body}
    `, { expects: construct });
    await expectActorBehavior(actor, ...steps);
  });

  it('document supplied through options.remotes', async () => {
    const actor = await createActor(`
      *
        "service.bv": Service #
      *
      ${body}
    `, {
      compileOptions: { remotes: [{ path: 'service.bv', params: '()', service: '{\n  ping. () => .\n} | Integer' }] },
      expects: construct,
    });
    await expectActorBehavior(actor, ...steps);
  });
});

describe('type coercion — compile errors when the document lacks the as type', () => {
  const counter = `
    @readInt
      =
      n Integer = Counter
      return n as Integer
  `;
  const service = `
    @asInt
      =
      n Integer = Service()
      return n as Integer
  `;

  it('service ref, declared in the header', () => {
    expect(() => compileSource(`
      *
        "/services/counter": Counter {
          get () -> (count: Integer)
        }
      *
      ${counter}
    `)).toThrow();
  });

  it('class ref, declared in the header', () => {
    expect(() => compileSource(`
      *
        "service.bv": Service () -> *{
          ping. () => .
        }
      *
      ${service}
    `)).toThrow();
  });

  it('service ref, through options.remotes', () => {
    expect(() => compileSource(`
      *
        "/services/counter": Counter
      *
      ${counter}
    `, { remotes: [{ path: '/services/counter', service: '{\n  get () -> (count: Integer)\n}' }] })).toThrow();
  });

  it('class ref, through options.remotes', () => {
    expect(() => compileSource(`
      *
        "service.bv": Service #
      *
      ${service}
    `, { remotes: [{ path: 'service.bv', params: '()', service: '{\n  ping. () => .\n}' }] })).toThrow();
  });
});

// ── `as` renders or fails ───────────────────────────────────────────────────
// A failed `as` ends the enclosing call with an `ex` naming both types, and no
// later code sees the value.

describe('as — provably wrong is a compile error', () => {
  it.each([
    ['"x" as Integer', 'return "x" as Integer', 'Text as Integer'],
    ['"42" as Integer', 'return "42" as Integer', 'Text as Integer'],
    ['42 as Text', 'return 42 as Text', 'Integer as Text'],
    ['1.5 as Integer', 'return 1.5 as Integer', 'Decimal as Integer'],
    ['null as Integer', 'x = null as Integer\nreturn r: x', 'null as Integer'],
    ['true as Text', 'return true as Text', 'Boolean as Text'],
    ['bound first', 'x = "x" as Integer\nreturn x', 'Text as Integer'],
    ['"x" as a Type', 'return "x" as Point', 'Text as Point'],
    ['a Type as a scalar', 'p Point = Point(1, 2)\nreturn p as Text', 'Point as Text'],
  ])('%s', (_, body, message) => {
    expect(() => compileSource(`::Point (x: Integer, y: Integer)\n@go = {\n${body}\n}\n`)).toThrow(`Cannot render ${message}`);
  });
});

describe('as — values in this file', () => {
  const script = `
    Answer = * {
      self as Integer = -> 42
    }

    NoClauses = * {
      @ping = -> pong: "ok"
    }

    Liar = (v Anything) *{
      self as Integer = -> v
    }

    mixed = (b Boolean) {
      if b { return 1 }
      return "x"
    }
    oneValue = { return 1 }
    oneNamed = { return a: 1 }
    twoValues = { return 1, 2 }

    @integerAsFloat = {
      x = 1 as Float
      return r: x / 2
    }
    @integerAsDecimal = {
      x = 1 as Decimal
      return r: x + 0.5
    }
    @textAsBlob = {
      t Text = "héllo"
      b Blob = t as Blob
      return r: Blob.size(b)
    }
    @sameType = {
      x = 42 as Integer
      return r: x + 1
    }

    @paramBound = (v Integer | Text) {
      x Integer = v as Integer
      return r: x + 1
    }
    @paramReturned = (v Integer | Text) {
      return v as Integer
    }
    @paramUnion = (v Integer | Text | Boolean) {
      x Integer | Text = v as Integer | Text
      return r: "ok"
    }
    @paramTyped = (v Integer) {
      return r: v + 1
    }

    @callBound = (b Boolean) {
      x Integer = mixed(b) as Integer
      return r: x + 1
    }
    @callUnused = {
      y = mixed(false) as Integer
      return r: y
    }
    @callReturned = {
      return mixed(false) as Integer
    }

    @actorReturned = {
      c = Answer()
      return c as Integer
    }
    @actorBound = {
      c = Answer()
      n Integer = c as Integer
      return r: n + 1
    }
    @actorWrongClause = {
      c = Answer()
      n Text = c
      return r: n
    }
    @actorNoClauses = {
      c = NoClauses()
      n Integer = c
      return r: n
    }
    @actorLies = {
      c = Liar("x")
      n Integer = c
      return r: n
    }

    @soleValue = {
      x = oneValue()
      return r: x
    }
    @soleNamed = {
      x = oneNamed()
      return r: x
    }
    @soleOfTwo = {
      x = twoValues()
      return r: x
    }
    @objectInField = {
      x = oneValue() as Object
      return r: x
    }
    @namedObjectInField = {
      x = oneNamed() as Object
      return r: x
    }
    @wholeReply = {
      x = twoValues() as Object
      return ...x
    }
    @scalarAsObject = {
      x = 1 as Object
      return ...x
    }
    @objectUnwraps = {
      a Integer = Object(42)
      return r: a
    }
  `;

  describe('lossless renderings', () => {
    it('Integer as Float changes later arithmetic', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@integerAsFloat', from: 'c' } },
        { output: { id: '1', re: { r: 0.5 }, 'ty': { r: 'Float' }, to: 'c' } },
      );
    });
    it('Integer as Decimal', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@integerAsDecimal', from: 'c' } },
        { output: { id: '1', re: { r: 1.5 }, 'ty': { r: 'Decimal' }, to: 'c' } },
      );
    });
    it('Text as Blob reads bytes', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@textAsBlob', from: 'c' } },
        { output: { id: '1', re: { r: 6 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
    it('the same type leaves the value alone', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@sameType', from: 'c' } },
        { output: { id: '1', re: { r: 43 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
  });

  describe('a param', () => {
    it('bound, holding the type', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [[41], '@paramBound'], 'ty': [['Integer']], from: 'c' } },
        { output: { id: '1', re: { r: 42 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
    it('bound, holding another type', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [['x'], '@paramBound'], 'ty': [['Text']], from: 'c' } },
        { output: { id: '1', ex: { '@paramBound': 'as Integer: got Text' }, to: 'c' } },
      );
    });
    it('returned, holding the type', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [[41], '@paramReturned'], 'ty': [['Integer']], from: 'c' } },
        { output: { id: '1', re: [41], 'ty': ['Integer'], to: 'c' } },
      );
    });
    it('returned, holding another type', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [['x'], '@paramReturned'], 'ty': [['Text']], from: 'c' } },
        { output: { id: '1', ex: { '@paramReturned': 'as Integer: got Text' }, to: 'c' } },
      );
    });
    it('a union takes any member', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [['x'], '@paramUnion'], 'ty': [['Text']], from: 'c' } },
        { output: { id: '1', re: { r: 'ok' }, 'ty': { r: 'Text' }, to: 'c' } },
      );
    });
    it('a union fails on anything else', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [[true], '@paramUnion'], 'ty': [['Boolean']], from: 'c' } },
        { output: { id: '1', ex: { '@paramUnion': 'as Integer | Text: got Boolean' }, to: 'c' } },
      );
    });
    it('a typed param whose tag lies', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [['x'], '@paramTyped'], 'ty': [['Integer']], from: 'c' } },
        { output: { id: '1', ex: { '@paramTyped': 'as Integer: got Text' }, to: 'c' } },
      );
    });
  });

  describe('a local call', () => {
    it('the path that holds', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [[true], '@callBound'], 'ty': [['Boolean']], from: 'c' } },
        { output: { id: '1', re: { r: 2 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
    it('the path that fails, before later code', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [[false], '@callBound'], 'ty': [['Boolean']], from: 'c' } },
        { output: { id: '1', ex: { '@callBound': 'as Integer: got Text' }, to: 'c' } },
      );
    });
    it('fails with no arithmetic after it', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@callUnused', from: 'c' } },
        { output: { id: '1', ex: { '@callUnused': 'as Integer: got Text' }, to: 'c' } },
      );
    });
    it('fails on return', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@callReturned', from: 'c' } },
        { output: { id: '1', ex: { '@callReturned': 'as Integer: got Text' }, to: 'c' } },
      );
    });
  });

  describe('an actor', () => {
    it('c as T asks the actor', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@actorReturned', from: 'c' } },
        { output: { id: '1', re: [42], 'ty': ['Integer'], to: 'c' } },
      );
    });
    it('n T = c as T asks the actor', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@actorBound', from: 'c' } },
        { output: { id: '1', re: { r: 43 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
    it('no clause for the type fails', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@actorWrongClause', from: 'c' } },
        { output: { id: '1', ex: { '@actorWrongClause': 'error' }, to: 'c' } },
      );
    });
    it('no clauses at all fails', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@actorNoClauses', from: 'c' } },
        { output: { id: '1', ex: { '@actorNoClauses': 'error' }, to: 'c' } },
      );
    });
    it('a clause that renders the wrong type fails', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@actorLies', from: 'c' } },
        { output: { id: '1', ex: { '@actorLies': 'as Integer: got Text' }, to: 'c' } },
      );
    });
  });

  describe('Object', () => {
    it('an untyped bind takes a sole positional', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@soleValue', from: 'c' } },
        { output: { id: '1', re: { r: 1 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
    it('an untyped bind of a named reply fails', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@soleNamed', from: 'c' } },
        { output: { id: '1', ex: { '@soleNamed': 'error' }, to: 'c' } },
      );
    });
    it('an untyped bind of two positionals fails', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@soleOfTwo', from: 'c' } },
        { output: { id: '1', ex: { '@soleOfTwo': 'error' }, to: 'c' } },
      );
    });
    it('a positional Object in a named field goes out in wire form', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@objectInField', from: 'c' } },
        { output: { id: '1', re: { r: [1] }, 'ty': { r: 'Object' }, to: 'c' } },
      );
    });
    it('a named Object in a named field goes out in wire form', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@namedObjectInField', from: 'c' } },
        { output: { id: '1', re: { r: { a: 1 } }, 'ty': { r: 'Object' }, to: 'c' } },
      );
    });
    it('as Object binds the whole reply', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@wholeReply', from: 'c' } },
        { output: expect.objectContaining({ id: '1', re: [1, 2], to: 'c' }) },
      );
    });
    it('a scalar as Object wraps', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@scalarAsObject', from: 'c' } },
        { output: expect.objectContaining({ id: '1', re: [1], to: 'c' }) },
      );
    });
    it('a one-entry Object unwraps into a typed bind', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@objectUnwraps', from: 'c' } },
        { output: { id: '1', re: { r: 42 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
  });
});

describe('as — remote replies', () => {
  const script = `
    ::Point (x: Integer, y: Integer)

    *
      "/s": Svc {
        text () -> (Text)
        int () -> (Integer)
        float () -> (Float)
        field () -> (a: Integer)
        any () -> (Anything)
      }
    *

    @overDoc = {
      x Integer = Svc.text() as Integer
      return r: x + 1
    }
    @bare = {
      x Integer = Svc.int()
      return r: x + 1
    }
    @destructured = {
      :a Integer = Svc.field()
      return r: a
    }
    @whole = {
      x = Svc.text() as Object
      return ...x
    }
    @floatBare = {
      x Float = Svc.float()
      return r: x / 2
    }
    @floatAsInteger = {
      x Integer = Svc.float() as Integer
      return r: x + 1
    }
    @point = {
      p Point = Svc.any() as Point
      return r: (p.x + p.y) as Integer
    }
  `;

  describe('as, against a document', () => {
    it('a reply of the document type fails', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: '@overDoc', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: '@text', to: 'Svc' }) },
        { input: { id: '1', re: ['x'], 'ty': ['Text'] } },
        { output: { id: '99', ex: { '@overDoc': 'as Integer: got Text' }, to: 'c' } },
      );
    });
    it('a reply of the claimed type passes', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: '@overDoc', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: '@text', to: 'Svc' }) },
        { input: { id: '1', re: [41], 'ty': ['Integer'] } },
        { output: { id: '99', re: { r: 42 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
  });

  describe('a bare annotation is checked too', () => {
    it('the reply matches', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: '@bare', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: '@int', to: 'Svc' }) },
        { input: { id: '1', re: [41], 'ty': ['Integer'] } },
        { output: { id: '99', re: { r: 42 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
    it('the document is wrong', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: '@bare', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: '@int', to: 'Svc' }) },
        { input: { id: '1', re: ['x'], 'ty': ['Text'] } },
        { output: { id: '99', ex: { '@bare': 'as Integer: got Text' }, to: 'c' } },
      );
    });
    it('the tag lies', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: '@bare', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: '@int', to: 'Svc' }) },
        { input: { id: '1', re: ['x'], 'ty': ['Integer'] } },
        { output: { id: '99', ex: { '@bare': 'as Integer: got Text' }, to: 'c' } },
      );
    });
    it('a destructured field is wrong', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: '@destructured', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: '@field', to: 'Svc' }) },
        { input: { id: '1', re: { a: 'x' }, 'ty': { a: 'Integer' } } },
        { output: { id: '99', ex: { '@destructured': 'as Integer: got Text' }, to: 'c' } },
      );
    });
  });

  describe('Object and numbers', () => {
    it('as Object keeps a one-entry reply', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: '@whole', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: '@text', to: 'Svc' }) },
        { input: { id: '1', re: ['x'], 'ty': ['Text'] } },
        { output: expect.objectContaining({ id: '99', re: ['x'], to: 'c' }) },
      );
    });
    it('a Float that arrives as a whole number', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: '@floatBare', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: '@float', to: 'Svc' }) },
        { input: { id: '1', re: [3], 'ty': ['Float'] } },
        { output: { id: '99', re: { r: 1.5 }, 'ty': { r: 'Float' }, to: 'c' } },
      );
    });
    it('a whole Float as Integer', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: '@floatAsInteger', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: '@float', to: 'Svc' }) },
        { input: { id: '1', re: [3], 'ty': ['Float'] } },
        { output: { id: '99', re: { r: 4 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
    it('a fractional Float as Integer', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: '@floatAsInteger', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: '@float', to: 'Svc' }) },
        { input: { id: '1', re: [1.5], 'ty': ['Float'] } },
        { output: { id: '99', ex: { '@floatAsInteger': 'as Integer: got Float' }, to: 'c' } },
      );
    });
  });

  describe('a Type', () => {
    it('a named reply with the fields passes', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: '@point', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: '@any', to: 'Svc' }) },
        { input: { id: '1', re: { x: 1, y: 2 }, 'ty': { x: 'Integer', y: 'Integer' } } },
        { output: { id: '99', re: { r: 3 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
    it('extra fields are dropped', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: '@point', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: '@any', to: 'Svc' }) },
        { input: { id: '1', re: { x: 1, y: 2, z: 3 }, 'ty': { x: 'Integer', y: 'Integer', z: 'Integer' } } },
        { output: { id: '99', re: { r: 3 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
    it('a tagged positional passes', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: '@point', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: '@any', to: 'Svc' }) },
        { input: { id: '1', re: [[1, 2]], 'ty': ['. ::Point'] } },
        { output: { id: '99', re: { r: 3 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
    it('a missing field fails', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: '@point', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: '@any', to: 'Svc' }) },
        { input: { id: '1', re: { x: 1 }, 'ty': { x: 'Integer' } } },
        { output: { id: '99', ex: { '@point': 'as Point: got Object' }, to: 'c' } },
      );
    });
    it('a wrong field fails', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: '@point', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: '@any', to: 'Svc' }) },
        { input: { id: '1', re: { x: 1, y: 'no' }, 'ty': { x: 'Integer', y: 'Text' } } },
        { output: { id: '99', ex: { '@point': 'as Point: got Object' }, to: 'c' } },
      );
    });
    it('a scalar fails', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: '@point', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: '@any', to: 'Svc' }) },
        { input: { id: '1', re: ['x'], 'ty': ['Text'] } },
        { output: { id: '99', ex: { '@point': 'as Point: got Text' }, to: 'c' } },
      );
    });
  });
});
