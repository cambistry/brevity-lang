import { createActor, expectActorBehavior, expectBehavior, compileSource } from '../helpers.js';

describe('type coercion — runtime', () => {
  const script = `
    use Counter = "/services/counter" as {
      get () -> (count: Integer)
    } | Integer
    use Store = "/services/store" as {
      ping. () => .
    } | Integer | Text
    use Service = "service.bv" as () -> *{
      ping. () => .
    } | Integer | Text
    use Svc = "/s" as {
      text () -> (Text)
      int () -> (Integer)
      float () -> (Float)
      field () -> (a: Integer)
      any () -> (Anything)
    }

    // type coercion — declared in the header

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

    // as — values in this file
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

    // as — remote replies
    type Point (x: Integer, y: Integer)

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

  // ── Asking an actor: a typed bind sends [Type, "as"] ────────────────────────

  it('type coercion — declared in the header — service ref — sends [Integer, as] and replies with the value', async () => {
    await expectBehavior(script,
      { input: { id: '99', op: 'counterInt', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', op: ['Integer', '$as'], to: '/services/counter' }) },
      { input: { id: '1', re: [42], 'ty': ['Integer'] } },
      { output: { id: '99', re: [42], 'ty': ['Integer'], to: 'caller' } },
    );
  });

  it('type coercion — declared in the header — service ref with several as types — sends the bound type', async () => {
    await expectBehavior(script,
      { input: { id: '99', op: 'storeInt', from: 'caller' } },
      { output: expect.objectContaining({ op: ['Integer', '$as'], to: '/services/store' }) },
    );
    await expectBehavior(script,
      { input: { id: '99', op: 'storeText', from: 'caller' } },
      { output: expect.objectContaining({ op: ['Text', '$as'], to: '/services/store' }) },
    );
  });

  it('type coercion — declared in the header — class ref, one step — new, then [Integer, as]', async () => {
    await expectBehavior(script,
      { input: { id: '99', op: 'serviceInt', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', op: '$new', to: 'service.bv' }) },
      { input: { id: '1', re: ['#<Service/1>'], 'ty': ['service.bv'], from: 'service.bv' } },
      { output: expect.objectContaining({ id: '2', op: ['Integer', '$as'], to: 'Service/1' }) },
      { input: { id: '2', re: [42], 'ty': ['Integer'] } },
      { output: { id: '99', re: [42], 'ty': ['Integer'], to: 'caller' } },
    );
  });

  it('type coercion — declared in the header — class ref, one step — new, then [Text, as]', async () => {
    await expectBehavior(script,
      { input: { id: '99', op: 'serviceText', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', op: '$new', to: 'service.bv' }) },
      { input: { id: '1', re: ['#<Service/1>'], 'ty': ['service.bv'], from: 'service.bv' } },
      { output: expect.objectContaining({ id: '2', op: ['Text', '$as'], to: 'Service/1' }) },
      { input: { id: '2', re: ['hello'], 'ty': ['Text'] } },
      { output: { id: '99', re: ['hello'], 'ty': ['Text'], to: 'caller' } },
    );
  });

  describe('lossless renderings', () => {
    it('as — values in this file — Integer as Float changes later arithmetic', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'integerAsFloat', from: 'c' } },
        { output: { id: '1', re: { r: 0.5 }, 'ty': { r: 'Float' }, to: 'c' } },
      );
    });
    it('as — values in this file — Integer as Decimal', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'integerAsDecimal', from: 'c' } },
        { output: { id: '1', re: { r: 1.5 }, 'ty': { r: 'Decimal' }, to: 'c' } },
      );
    });
    it('as — values in this file — Text as Blob reads bytes', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'textAsBlob', from: 'c' } },
        { output: { id: '1', re: { r: 6 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
    it('as — values in this file — the same type leaves the value alone', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'sameType', from: 'c' } },
        { output: { id: '1', re: { r: 43 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
  });

  describe('a param', () => {
    it('as — values in this file — bound, holding the type', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [[41], 'paramBound'], 'ty': [['Integer']], from: 'c' } },
        { output: { id: '1', re: { r: 42 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
    it('as — values in this file — bound, holding another type', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [['x'], 'paramBound'], 'ty': [['Text']], from: 'c' } },
        { output: { id: '1', ex: { 'paramBound': 'as Integer: got Text' }, to: 'c' } },
      );
    });
    it('as — values in this file — returned, holding the type', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [[41], 'paramReturned'], 'ty': [['Integer']], from: 'c' } },
        { output: { id: '1', re: [41], 'ty': ['Integer'], to: 'c' } },
      );
    });
    it('as — values in this file — returned, holding another type', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [['x'], 'paramReturned'], 'ty': [['Text']], from: 'c' } },
        { output: { id: '1', ex: { 'paramReturned': 'as Integer: got Text' }, to: 'c' } },
      );
    });
    it('as — values in this file — a union takes any member', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [['x'], 'paramUnion'], 'ty': [['Text']], from: 'c' } },
        { output: { id: '1', re: { r: 'ok' }, 'ty': { r: 'Text' }, to: 'c' } },
      );
    });
    it('as — values in this file — a union fails on anything else', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [[true], 'paramUnion'], 'ty': [['Boolean']], from: 'c' } },
        { output: { id: '1', ex: { 'paramUnion': 'as Integer | Text: got Boolean' }, to: 'c' } },
      );
    });
    it('as — values in this file — a typed param whose tag lies', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [['x'], 'paramTyped'], 'ty': [['Integer']], from: 'c' } },
        { output: { id: '1', ex: { 'paramTyped': 'as Integer: got Text' }, to: 'c' } },
      );
    });
  });

  describe('a local call', () => {
    it('as — values in this file — the path that holds', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [[true], 'callBound'], 'ty': [['Boolean']], from: 'c' } },
        { output: { id: '1', re: { r: 2 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
    it('as — values in this file — the path that fails, before later code', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [[false], 'callBound'], 'ty': [['Boolean']], from: 'c' } },
        { output: { id: '1', ex: { 'callBound': 'as Integer: got Text' }, to: 'c' } },
      );
    });
    it('as — values in this file — fails with no arithmetic after it', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'callUnused', from: 'c' } },
        { output: { id: '1', ex: { 'callUnused': 'as Integer: got Text' }, to: 'c' } },
      );
    });
    it('as — values in this file — fails on return', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'callReturned', from: 'c' } },
        { output: { id: '1', ex: { 'callReturned': 'as Integer: got Text' }, to: 'c' } },
      );
    });
  });

  describe('an actor', () => {
    it('as — values in this file — c as T asks the actor', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'actorReturned', from: 'c' } },
        { output: { id: '1', re: [42], 'ty': ['Integer'], to: 'c' } },
      );
    });
    it('as — values in this file — n T = c as T asks the actor', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'actorBound', from: 'c' } },
        { output: { id: '1', re: { r: 43 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
    it('as — values in this file — no clause for the type fails', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'actorWrongClause', from: 'c' } },
        { output: { id: '1', ex: { 'actorWrongClause': 'error' }, to: 'c' } },
      );
    });
    it('as — values in this file — no clauses at all fails', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'actorNoClauses', from: 'c' } },
        { output: { id: '1', ex: { 'actorNoClauses': 'error' }, to: 'c' } },
      );
    });
    it('as — values in this file — a clause that renders the wrong type fails', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'actorLies', from: 'c' } },
        { output: { id: '1', ex: { 'actorLies': 'as Integer: got Text' }, to: 'c' } },
      );
    });
  });

  describe('Object', () => {
    it('as — values in this file — an untyped bind takes a sole positional', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'soleValue', from: 'c' } },
        { output: { id: '1', re: { r: 1 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
    it('as — values in this file — an untyped bind of a named reply fails', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'soleNamed', from: 'c' } },
        { output: { id: '1', ex: { 'soleNamed': 'error' }, to: 'c' } },
      );
    });
    it('as — values in this file — an untyped bind of two positionals fails', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'soleOfTwo', from: 'c' } },
        { output: { id: '1', ex: { 'soleOfTwo': 'error' }, to: 'c' } },
      );
    });
    it('as — values in this file — a positional Object in a named field goes out in wire form', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'objectInField', from: 'c' } },
        { output: { id: '1', re: { r: [1] }, 'ty': { r: 'Object' }, to: 'c' } },
      );
    });
    it('as — values in this file — a named Object in a named field goes out in wire form', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'namedObjectInField', from: 'c' } },
        { output: { id: '1', re: { r: { a: 1 } }, 'ty': { r: 'Object' }, to: 'c' } },
      );
    });
    it('as — values in this file — as Object binds the whole reply', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'wholeReply', from: 'c' } },
        { output: expect.objectContaining({ id: '1', re: [1, 2], to: 'c' }) },
      );
    });
    it('as — values in this file — a scalar as Object wraps', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'scalarAsObject', from: 'c' } },
        { output: expect.objectContaining({ id: '1', re: [1], to: 'c' }) },
      );
    });
    it('as — values in this file — a one-entry Object unwraps into a typed bind', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'objectUnwraps', from: 'c' } },
        { output: { id: '1', re: { r: 42 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
  });

  describe('as, against a document', () => {
    it('as — remote replies — a reply of the document type fails', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: 'overDoc', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: 'text', to: '/s' }) },
        { input: { id: '1', re: ['x'], 'ty': ['Text'] } },
        { output: { id: '99', ex: { 'overDoc': 'as Integer: got Text' }, to: 'c' } },
      );
    });
    it('as — remote replies — a reply of the claimed type passes', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: 'overDoc', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: 'text', to: '/s' }) },
        { input: { id: '1', re: [41], 'ty': ['Integer'] } },
        { output: { id: '99', re: { r: 42 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
  });

  describe('a bare annotation is checked too', () => {
    it('as — remote replies — the reply matches', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: 'bare', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: 'int', to: '/s' }) },
        { input: { id: '1', re: [41], 'ty': ['Integer'] } },
        { output: { id: '99', re: { r: 42 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
    it('as — remote replies — the document is wrong', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: 'bare', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: 'int', to: '/s' }) },
        { input: { id: '1', re: ['x'], 'ty': ['Text'] } },
        { output: { id: '99', ex: { 'bare': 'as Integer: got Text' }, to: 'c' } },
      );
    });
    it('as — remote replies — the tag lies', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: 'bare', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: 'int', to: '/s' }) },
        { input: { id: '1', re: ['x'], 'ty': ['Integer'] } },
        { output: { id: '99', ex: { 'bare': 'as Integer: got Text' }, to: 'c' } },
      );
    });
    it('as — remote replies — a destructured field is wrong', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: 'destructured', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: 'field', to: '/s' }) },
        { input: { id: '1', re: { a: 'x' }, 'ty': { a: 'Integer' } } },
        { output: { id: '99', ex: { 'destructured': 'as Integer: got Text' }, to: 'c' } },
      );
    });
  });

  describe('Object and numbers', () => {
    it('as — remote replies — as Object keeps a one-entry reply', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: 'whole', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: 'text', to: '/s' }) },
        { input: { id: '1', re: ['x'], 'ty': ['Text'] } },
        { output: expect.objectContaining({ id: '99', re: ['x'], to: 'c' }) },
      );
    });
    it('as — remote replies — a Float that arrives as a whole number', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: 'floatBare', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: 'float', to: '/s' }) },
        { input: { id: '1', re: [3], 'ty': ['Float'] } },
        { output: { id: '99', re: { r: 1.5 }, 'ty': { r: 'Float' }, to: 'c' } },
      );
    });
    it('as — remote replies — a whole Float as Integer', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: 'floatAsInteger', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: 'float', to: '/s' }) },
        { input: { id: '1', re: [3], 'ty': ['Float'] } },
        { output: { id: '99', re: { r: 4 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
    it('as — remote replies — a fractional Float as Integer', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: 'floatAsInteger', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: 'float', to: '/s' }) },
        { input: { id: '1', re: [1.5], 'ty': ['Float'] } },
        { output: { id: '99', ex: { 'floatAsInteger': 'as Integer: got Float' }, to: 'c' } },
      );
    });
  });

  describe('a Type', () => {
    it('as — remote replies — a named reply with the fields passes', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: 'point', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: 'any', to: '/s' }) },
        { input: { id: '1', re: { x: 1, y: 2 }, 'ty': { x: 'Integer', y: 'Integer' } } },
        { output: { id: '99', re: { r: 3 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
    it('as — remote replies — extra fields are dropped', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: 'point', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: 'any', to: '/s' }) },
        { input: { id: '1', re: { x: 1, y: 2, z: 3 }, 'ty': { x: 'Integer', y: 'Integer', z: 'Integer' } } },
        { output: { id: '99', re: { r: 3 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
    it('as — remote replies — a tagged positional passes', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: 'point', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: 'any', to: '/s' }) },
        { input: { id: '1', re: [[1, 2]], 'ty': [':Point'] } },
        { output: { id: '99', re: { r: 3 }, 'ty': { r: 'Integer' }, to: 'c' } },
      );
    });
    it('as — remote replies — a missing field fails', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: 'point', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: 'any', to: '/s' }) },
        { input: { id: '1', re: { x: 1 }, 'ty': { x: 'Integer' } } },
        { output: { id: '99', ex: { 'point': 'as Point: got Object' }, to: 'c' } },
      );
    });
    it('as — remote replies — a wrong field fails', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: 'point', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: 'any', to: '/s' }) },
        { input: { id: '1', re: { x: 1, y: 'no' }, 'ty': { x: 'Integer', y: 'Text' } } },
        { output: { id: '99', ex: { 'point': 'as Point: got Object' }, to: 'c' } },
      );
    });
    it('as — remote replies — a scalar fails', async () => {
      await expectBehavior(script,
        { input: { id: '99', op: 'point', from: 'c' } },
        { output: expect.objectContaining({ id: '1', op: 'any', to: '/s' }) },
        { input: { id: '1', re: ['x'], 'ty': ['Text'] } },
        { output: { id: '99', ex: { 'point': 'as Point: got Text' }, to: 'c' } },
      );
    });
  });
});

describe('type coercion — documents supplied through options.remotes', () => {
  const script = `
    use Counter = "/services/counter"
    use Store = "/services/store"
    use Service = "service.bv"

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

  it('service ref — sends [Integer, as] and replies with the value', async () => {
    await expectActorBehavior(await createActor(script, { compileOptions: { remotes } }),
      { input: { id: '99', op: 'counterInt', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', op: ['Integer', '$as'], to: '/services/counter' }) },
      { input: { id: '1', re: [42], 'ty': ['Integer'] } },
      { output: { id: '99', re: [42], 'ty': ['Integer'], to: 'caller' } },
    );
  });

  it('service ref with several as types — sends the bound type', async () => {
    await expectActorBehavior(await createActor(script, { compileOptions: { remotes } }),
      { input: { id: '99', op: 'storeInt', from: 'caller' } },
      { output: expect.objectContaining({ op: ['Integer', '$as'], to: '/services/store' }) },
    );
    await expectActorBehavior(await createActor(script, { compileOptions: { remotes } }),
      { input: { id: '99', op: 'storeText', from: 'caller' } },
      { output: expect.objectContaining({ op: ['Text', '$as'], to: '/services/store' }) },
    );
  });

  it('class ref, one step — new, then [Integer, as]', async () => {
    await expectActorBehavior(await createActor(script, { compileOptions: { remotes } }),
      { input: { id: '99', op: 'serviceInt', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', op: '$new', to: 'service.bv' }) },
      { input: { id: '1', re: ['#<Service/1>'], 'ty': ['service.bv'], from: 'service.bv' } },
      { output: expect.objectContaining({ id: '2', op: ['Integer', '$as'], to: 'Service/1' }) },
      { input: { id: '2', re: [42], 'ty': ['Integer'] } },
      { output: { id: '99', re: [42], 'ty': ['Integer'], to: 'caller' } },
    );
  });

  it('class ref, one step — new, then [Text, as]', async () => {
    await expectActorBehavior(await createActor(script, { compileOptions: { remotes } }),
      { input: { id: '99', op: 'serviceText', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', op: '$new', to: 'service.bv' }) },
      { input: { id: '1', re: ['#<Service/1>'], 'ty': ['service.bv'], from: 'service.bv' } },
      { output: expect.objectContaining({ id: '2', op: ['Text', '$as'], to: 'Service/1' }) },
      { input: { id: '2', re: ['hello'], 'ty': ['Text'] } },
      { output: { id: '99', re: ['hello'], 'ty': ['Text'], to: 'caller' } },
    );
  });
});

describe('type coercion — class ref constructed at the top level', () => {
  it('declared in the header', async () => {
    const actor = await createActor(`
      use Service = "service.bv" as () -> *{
        ping. () => .
      } | Integer

      s = Service()

      @asInt
        =
        n Integer = s
        return n as Integer
    `, { expects: [{ output: expect.objectContaining({ op: '$new', to: 'service.bv' }) }] });
    await expectActorBehavior(actor,
      { input: { id: '1', re: ['#<Service/1>'], 'ty': ['service.bv'], from: 'service.bv' } },
      { input: { id: '99', op: 'asInt', from: 'caller' } },
      { output: expect.objectContaining({ op: ['Integer', '$as'], to: 'Service/1' }) },
      { input: { id: '2', re: [42], 'ty': ['Integer'] } },
      { output: { id: '99', re: [42], 'ty': ['Integer'], to: 'caller' } },
    );
  });

  it('document supplied through options.remotes', async () => {
    const actor = await createActor(`
      use Service = "service.bv"

      s = Service()

      @asInt
        =
        n Integer = s
        return n as Integer
    `, {
      compileOptions: { remotes: [{ path: 'service.bv', params: '()', service: '{\n  ping. () => .\n} | Integer' }] },
      expects: [{ output: expect.objectContaining({ op: '$new', to: 'service.bv' }) }],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: ['#<Service/1>'], 'ty': ['service.bv'], from: 'service.bv' } },
      { input: { id: '99', op: 'asInt', from: 'caller' } },
      { output: expect.objectContaining({ op: ['Integer', '$as'], to: 'Service/1' }) },
      { input: { id: '2', re: [42], 'ty': ['Integer'] } },
      { output: { id: '99', re: [42], 'ty': ['Integer'], to: 'caller' } },
    );
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
      use Counter = "/services/counter" as {
        get () -> (count: Integer)
      }
      ${counter}
    `)).toThrow();
  });

  it('class ref, declared in the header', () => {
    expect(() => compileSource(`
      use Service = "service.bv" as () -> *{
        ping. () => .
      }
      ${service}
    `)).toThrow();
  });

  it('service ref, through options.remotes', () => {
    expect(() => compileSource(`
      use Counter = "/services/counter"
      ${counter}
    `, { remotes: [{ path: '/services/counter', service: '{\n  get () -> (count: Integer)\n}' }] })).toThrow();
  });

  it('class ref, through options.remotes', () => {
    expect(() => compileSource(`
      use Service = "service.bv"
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
    expect(() => compileSource(`type Point (x: Integer, y: Integer)\n@go = {\n${body}\n}\n`)).toThrow(`Cannot render ${message}`);
  });
});