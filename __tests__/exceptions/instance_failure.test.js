import { expectBehavior } from '../helpers.js';

describe('a failed as on a class instance', () => {
  const script = `
    @Box = *{
      n *Integer = 5

      mixed = (b Boolean) {
        if b { return 1 }
        return "x"
      }
      inner = {
        return mixed(false) as Integer
      }

      @bad = {
        return mixed(false) as Integer
      }
      @good = { return 1 }
      @get = { return n }
      @typed = (i Integer) { return i }
      @typedNamed = (i: Integer) { return i }
      @typedSecond = (i Integer, t Text) { return t }
      @overloaded = (i Integer) { return i }
      @overloaded << (t Text) { return t }
      @anything = (a Anything) { return a }
      @viaFunction = {
        x = inner()
        return r: 9
      }
      @viaSelf = {
        x = @bad()
        return r: 9
      }
    }

    @SubBox = (@Box++) *{
      @own = (i Integer) { return i }
    }

    @Outer = *{
      @viaInstance = {
        b = @Box()
        r = b.bad()
        return r: 9
      }
    }

    cell *Integer = 11

    @getCell = { return cell }

    @bound = {
      b = @Box()
      r = b.bad()
      return r: 7
    }
    @typedBound = {
      b = @Box()
      r Integer = b.bad()
      return r: r
    }
    @ephemeral = {
      r Integer = @Box().bad()
      return r: r
    }
    @then = {
      b = @Box()
      r = b.bad() as Integer
      return r
    }
    @returned = {
      b = @Box()
      return b.bad()
    }
    @returnedGood = {
      b = @Box()
      return b.good()
    }
  `;

  const newBox = [
    { input: { id: '1', op: [{}, '$new'], to: '. Box', from: 'c' } },
    { output: { id: '1', re: '#<. Box 1>', 'ty': '. Box', to: 'c' } },
  ];

  describe('on the handler it failed in', () => {
    it('names both types', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: 'bad', to: '. Box 1', from: 'c' } },
        { output: { id: '2', ex: { 'bad': 'as Integer: got Text' }, to: 'c', from: '. Box 1' } },
      );
    });
    it('names both types for a typed param whose tag lies', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: [['x'], 'typed'], 'ty': [['Integer']], to: '. Box 1', from: 'c' } },
        { output: { id: '2', ex: { 'typed': 'as Integer: got Text' }, to: 'c', from: '. Box 1' } },
      );
    });
    it('names both types for a named param whose tag lies', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: [{ i: 'x' }, 'typedNamed'], 'ty': [{ i: 'Integer' }], to: '. Box 1', from: 'c' } },
        { output: { id: '2', ex: { 'typedNamed': 'as Integer: got Text' }, to: 'c', from: '. Box 1' } },
      );
    });
    it('answers unhandled for a typed param with an honest wrong tag', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: [['x'], 'typed'], 'ty': [['Text']], to: '. Box 1', from: 'c' } },
        { output: { id: '2', ex: { 'typed': 'unhandled' }, to: 'c', from: '. Box 1' } },
      );
    });
    it('goes by the tag when it is wrong and the value would fit', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: [[1], 'typed'], 'ty': [['Text']], to: '. Box 1', from: 'c' } },
        { output: { id: '2', ex: { 'typed': 'unhandled' }, to: 'c', from: '. Box 1' } },
      );
    });
    it('answers unhandled for a named param with an honest wrong tag', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: [{ i: 'x' }, 'typedNamed'], 'ty': [{ i: 'Text' }], to: '. Box 1', from: 'c' } },
        { output: { id: '2', ex: { 'typedNamed': 'unhandled' }, to: 'c', from: '. Box 1' } },
      );
    });
    it('answers unhandled when any param has a wrong tag', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: [[1, 2], 'typedSecond'], 'ty': [['Integer', 'Integer']], to: '. Box 1', from: 'c' } },
        { output: { id: '2', ex: { 'typedSecond': 'unhandled' }, to: 'c', from: '. Box 1' } },
      );
    });
    it('answers unhandled for a tag no overload takes', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: [[true], 'overloaded'], 'ty': [['Boolean']], to: '. Box 1', from: 'c' } },
        { output: { id: '2', ex: { 'overloaded': 'unhandled' }, to: 'c', from: '. Box 1' } },
      );
    });
    it('picks the overload the tag names', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: [[1], 'overloaded'], 'ty': [['Integer']], to: '. Box 1', from: 'c' } },
        { output: { id: '2', re: [1], 'ty': ['Integer'], to: 'c', from: '. Box 1' } },
        { input: { id: '3', op: [['x'], 'overloaded'], 'ty': [['Text']], to: '. Box 1', from: 'c' } },
        { output: { id: '3', re: ['x'], 'ty': ['Text'], to: 'c', from: '. Box 1' } },
      );
    });
    it('answers unhandled on a superclass handler and its own', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [{}, '$new'], to: '. SubBox', from: 'c' } },
        { output: { id: '1', re: '#<. SubBox 1>', 'ty': '. SubBox', to: 'c' } },
        { input: { id: '2', op: [['x'], 'typed'], 'ty': [['Text']], to: '. SubBox 1', from: 'c' } },
        { output: { id: '2', ex: { 'typed': 'unhandled' }, to: 'c', from: '. SubBox 1' } },
        { input: { id: '3', op: [['x'], 'own'], 'ty': [['Text']], to: '. SubBox 1', from: 'c' } },
        { output: { id: '3', ex: { 'own': 'unhandled' }, to: 'c', from: '. SubBox 1' } },
      );
    });
    it('answers unhandled for an op it does not have', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: [[1], 'missing'], 'ty': [['Integer']], to: '. Box 1', from: 'c' } },
        { output: { id: '2', ex: { 'missing': 'unhandled' }, to: 'c', from: '. Box 1' } },
      );
    });
    it('asks for a schema when args come with no tags', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: [['x'], 'typed'], to: '. Box 1', from: 'c' } },
        { output: { id: '2', ex: { 'typed': 'schema_required' }, to: 'c', from: '. Box 1' } },
      );
    });
    it('takes any tag for an Anything param', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: [['x'], 'anything'], 'ty': [['Text']], to: '. Box 1', from: 'c' } },
        { output: expect.objectContaining({ id: '2', re: ['x'], to: 'c', from: '. Box 1' }) },
      );
    });
    it('keeps answering after a wrong tag', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: [['x'], 'typed'], 'ty': [['Text']], to: '. Box 1', from: 'c' } },
        { output: { id: '2', ex: { 'typed': 'unhandled' }, to: 'c', from: '. Box 1' } },
        { input: { id: '3', op: [[4], 'typed'], 'ty': [['Integer']], to: '. Box 1', from: 'c' } },
        { output: { id: '3', re: [4], 'ty': ['Integer'], to: 'c', from: '. Box 1' } },
      );
    });
    it('leaves the instance answering, with its state', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: 'bad', to: '. Box 1', from: 'c' } },
        { output: { id: '2', ex: { 'bad': 'as Integer: got Text' }, to: 'c', from: '. Box 1' } },
        { input: { id: '3', op: 'get', to: '. Box 1', from: 'c' } },
        { output: expect.objectContaining({ id: '3', re: [5], to: 'c', from: '. Box 1' }) },
      );
    });
  });

  describe('on a call that received it', () => {
    it('an untyped bind fails before later code', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'bound', from: 'c' } },
        { output: { id: '1', ex: { 'bound': 'error' }, to: 'c' } },
      );
    });
    it('a typed bind', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'typedBound', from: 'c' } },
        { output: { id: '1', ex: { 'typedBound': 'error' }, to: 'c' } },
      );
    });
    it('a call on a constructed instance', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'ephemeral', from: 'c' } },
        { output: { id: '1', ex: { 'ephemeral': 'error' }, to: 'c' } },
      );
    });
    it('an as on the result', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'then', from: 'c' } },
        { output: { id: '1', ex: { 'then': 'error' }, to: 'c' } },
      );
    });
    it('a returned call', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'returned', from: 'c' } },
        { output: { id: '1', ex: { 'returned': 'error' }, to: 'c' } },
      );
    });
    it('another instance', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [{}, '$new'], to: '. Outer', from: 'c' } },
        { output: { id: '1', re: '#<. Outer 1>', 'ty': '. Outer', to: 'c' } },
        { input: { id: '2', op: 'viaInstance', to: '. Outer 1', from: 'c' } },
        { output: { id: '2', ex: { 'viaInstance': 'error' }, to: 'c', from: '. Outer 1' } },
      );
    });
    it('a function in the instance', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: 'viaFunction', to: '. Box 1', from: 'c' } },
        { output: { id: '2', ex: { 'viaFunction': 'error' }, to: 'c', from: '. Box 1' } },
      );
    });
    it('a self-call in the instance', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: 'viaSelf', to: '. Box 1', from: 'c' } },
        { output: { id: '2', ex: { 'viaSelf': 'error' }, to: 'c', from: '. Box 1' } },
      );
    });
    it('leaves the caller its state', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'bound', from: 'c' } },
        { output: { id: '1', ex: { 'bound': 'error' }, to: 'c' } },
        { input: { id: '2', op: 'getCell', from: 'c' } },
        { output: expect.objectContaining({ id: '2', re: [11], to: 'c' }) },
      );
    });
  });

  it('a returned call that succeeds replies with its value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'returnedGood', from: 'c' } },
      { output: { id: '1', re: [1], to: 'c' } },
    );
  });
});

describe('a failed as in the file', () => {
  const script = `
    mixed = (b Boolean) {
      if b { return 1 }
      return "x"
    }
    inner = {
      return mixed(false) as Integer
    }

    @anything = (a Anything) { return a }
    @bad = {
      return mixed(false) as Integer
    }
    @viaFunction = {
      x = inner()
      return r: 9
    }
    @viaSelf = {
      x = @bad()
      return r: 9
    }
  `;

  it('an Anything param takes any tag', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [['x'], 'anything'], 'ty': [['Text']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: ['x'], to: 'c' }) },
    );
  });
  it('a function call receives it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'viaFunction', from: 'c' } },
      { output: { id: '1', ex: { 'viaFunction': 'error' }, to: 'c' } },
    );
  });
  it('a self-call receives it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'viaSelf', from: 'c' } },
      { output: { id: '1', ex: { 'viaSelf': 'error' }, to: 'c' } },
    );
  });
});

describe('a failed as in a constructor block', () => {
  const script = `
    @Box = (v Anything) *{
      mixed = (b Boolean) {
        if b { return 1 }
        return "x"
      }
      n Integer = mixed(false) as Integer

      @get = { return n }
    }

    @Good = (v Anything) *{
      one = { return 1 }
      n Integer = v as Integer
      m = one() as Integer
      k *Integer = one() as Integer
      t Integer = one()

      @get = { return n: n, m: m, k: k, t: t }
    }

    @Untyped = (v Anything) *{
      n = v as Integer

      @get = { return n }
    }

    @Inner = (v Anything) *{
      mixed = (b Boolean) {
        if b { return 1 }
        return "x"
      }
      inner = { return mixed(false) as Integer }
      n Integer = inner()

      @get = { return n }
    }

    @Nested = *{
      b = @Box(1)

      @get = { return 1 }
    }

    @Sub = (@Good++) *{
      @more = { return 2 }
    }

    @NoParams = *{
      mixed = (b Boolean) {
        if b { return 1 }
        return "x"
      }
      n Integer = mixed(false) as Integer

      @get = { return n }
    }

    @SubNoParams = (@NoParams++) *{
      @more = { return 2 }
    }

    @Base = *{
      v Integer = 3

      @baseValue = { return v }
    }

    @SubOfBase = (@Base++) *{
      @more = { return 2 }
    }

    @ViaSub = *{
      n Integer = @SubOfBase().baseValue() as Integer

      @get = { return n }
    }

    @ViaSubFails = *{
      n Integer = @SubNoParams().get() as Integer

      @get = { return n }
    }

    @Reply = *{
      v Integer = 3

      @text = { return "x" }
      @int = { return v }
    }

    @ViaCall = *{
      n Integer = @Reply().text() as Integer

      @get = { return n }
    }

    @ViaCallOk = *{
      n Integer = @Reply().int() as Integer

      @get = { return n }
    }

    cell *Integer = 11

    @getCell = { return cell }
    @go = {
      b = @Box(1)
      return r: 7
    }
    @goTyped = {
      b = @Good("x")
      return r: 7
    }
    @goOk = {
      b = @Good(5)
      return b.get()
    }
    @goUntyped = {
      b = @Untyped("x")
      return r: 7
    }
    @goInner = {
      b = @Inner(1)
      return r: 7
    }
    @goNested = {
      b = @Nested()
      return r: 7
    }
    @goSub = {
      b = @Sub("x")
      return r: 7
    }
    @goChain = {
      r Integer = @Box(1).get()
      return r: r
    }
    @goNoParams = {
      b = @NoParams()
      return r: 7
    }
    @goNoParamsTyped = {
      r Integer = @NoParams().get()
      return r: r
    }
    @goNoParamsUntyped = {
      r = @NoParams().get()
      return r: r
    }
    @goNoParamsReturned = {
      return @NoParams().get()
    }
    @goSubNoParams = {
      b = @SubNoParams()
      return r: 7
    }
    @goSubNoParamsCall = {
      r = @SubNoParams().get()
      return r: r
    }
    @goViaSubFails = {
      b = @ViaSubFails()
      return r: 7
    }
    @goBlockRan = {
      r = @Reply().int()
      return r: r
    }
    @goBlockRanStored = {
      b = @Reply()
      r = b.int()
      return r: r
    }
    @goSubBlockRan = {
      r = @SubOfBase().baseValue()
      return r: r
    }
    @goSubBlockRanStored = {
      b = @SubOfBase()
      r = b.baseValue()
      return r: r
    }
    @goViaSub = {
      b = @ViaSub()
      return b.get()
    }
    @goViaCall = {
      b = @ViaCall()
      return r: 7
    }
    @goViaCallOk = {
      b = @ViaCallOk()
      return b.get()
    }
  `;

  describe('constructing through a handler', () => {
    it.each([
      ['a cell from a function', 'go'],
      ['a cell from a param', 'goTyped'],
      ['a cell with no declared type', 'goUntyped'],
      ['a function it calls', 'goInner'],
      ['a class it constructs', 'goNested'],
      ['a superclass', 'goSub'],
      ['a call on the constructed actor', 'goChain'],
      ['a call on an instance it constructs', 'goViaCall'],
      ['a class with no params', 'goNoParams'],
      ['a typed bind from a call on it', 'goNoParamsTyped'],
      ['an untyped bind from a call on it', 'goNoParamsUntyped'],
      ['a returned call on it', 'goNoParamsReturned'],
      ['a superclass with no params', 'goSubNoParams'],
      ['a call on a subclass of it', 'goSubNoParamsCall'],
      ['a call on that subclass in a constructor block', 'goViaSubFails'],
    ])('%s fails the caller', async (_, op) => {
      await expectBehavior(script,
        { input: { id: '1', op, from: 'c' } },
        { output: { id: '1', ex: { [op]: 'error' }, to: 'c' } },
      );
    });
    it('leaves the caller answering, with its state', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'go', from: 'c' } },
        { output: { id: '1', ex: { 'go': 'error' }, to: 'c' } },
        { input: { id: '2', op: 'getCell', from: 'c' } },
        { output: expect.objectContaining({ id: '2', re: [11], to: 'c' }) },
      );
    });
    it('stores the value when it renders', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'goOk', from: 'c' } },
        { output: expect.objectContaining({ id: '1', re: { n: 5, m: 1, k: 1, t: 1 }, to: 'c' }) },
      );
    });
    // With no params to prompt it, the block still runs: these read what it stored,
    // since a skipped block can also pass a failure test by leaving a null.
    it.each([
      ['a call on a new instance', 'goBlockRan'],
      ['a call on a bound instance', 'goBlockRanStored'],
      ['a call on a new subclass instance', 'goSubBlockRan'],
      ['a call on a bound subclass instance', 'goSubBlockRanStored'],
    ])('runs the block of a class with no params: %s', async (_, op) => {
      await expectBehavior(script,
        { input: { id: '1', op, from: 'c' } },
        { output: expect.objectContaining({ id: '1', re: { r: 3 }, to: 'c' }) },
      );
    });
    it('runs a superclass block for a call in a constructor block', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'goViaSub', from: 'c' } },
        { output: expect.objectContaining({ id: '1', re: [3], to: 'c' }) },
      );
    });
    it('stores the value of a call on an instance', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: 'goViaCallOk', from: 'c' } },
        { output: expect.objectContaining({ id: '1', re: [3], to: 'c' }) },
      );
    });
  });

  describe('constructing through #new', () => {
    const newGood = (id, arg) => ({ input: { id, op: [[arg], '$new'], ty: [[typeof arg === 'string' ? 'Text' : 'Integer']], to: '. Good', from: 'c' } });

    it('fails the call', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: '. Box', from: 'c' } },
        { output: { id: '1', ex: { '$new': 'error' }, to: 'c' } },
      );
    });
    it('takes no address', async () => {
      await expectBehavior(script,
        newGood('1', 'x'),
        { output: { id: '1', ex: { '$new': 'error' }, to: 'c' } },
        newGood('2', 5),
        { output: { id: '2', re: '#<. Good 1>', 'ty': '. Good', to: 'c' } },
        { input: { id: '3', op: 'get', to: '. Good 1', from: 'c' } },
        { output: expect.objectContaining({ id: '3', re: { n: 5, m: 1, k: 1, t: 1 }, to: 'c', from: '. Good 1' }) },
      );
    });
    it('leaves the file answering, with its state', async () => {
      await expectBehavior(script,
        newGood('1', 'x'),
        { output: { id: '1', ex: { '$new': 'error' }, to: 'c' } },
        { input: { id: '2', op: 'getCell', from: 'c' } },
        { output: expect.objectContaining({ id: '2', re: [11], to: 'c' }) },
      );
    });
  });
});
