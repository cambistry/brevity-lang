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
      @viaFunction = {
        x = inner()
        return r: 9
      }
      @viaSelf = {
        x = @bad()
        return r: 9
      }
    }

    @Outer = *{
      @viaInstance = {
        b = Box()
        r = b.bad()
        return r: 9
      }
    }

    cell *Integer = 11

    @getCell = { return cell }

    @bound = {
      b = Box()
      r = b.bad()
      return r: 7
    }
    @typedBound = {
      b = Box()
      r Integer = b.bad()
      return r: r
    }
    @ephemeral = {
      r Integer = Box().bad()
      return r: r
    }
    @then = {
      b = Box()
      r = b.bad() as Integer
      return r
    }
    @returned = {
      b = Box()
      return b.bad()
    }
    @returnedGood = {
      b = Box()
      return b.good()
    }
  `;

  const newBox = [
    { input: { id: '1', op: [{}, '#new'], to: '@Box', from: 'c' } },
    { output: { id: '1', re: '#<@Box/1>', 'bv-a': '#<@Box>', to: 'c' } },
  ];

  describe('on the handler it failed in', () => {
    it('names both types', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: '@bad', to: '@Box/1', from: 'c' } },
        { output: { id: '2', ex: { '@bad': 'as Integer: got Text' }, to: 'c', from: '@Box/1' } },
      );
    });
    it('names both types for a typed param whose tag lies', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: [['x'], '@typed'], 'bv-a': [['Integer']], to: '@Box/1', from: 'c' } },
        { output: { id: '2', ex: { '@typed': 'as Integer: got Text' }, to: 'c', from: '@Box/1' } },
      );
    });
    it('leaves the instance answering, with its state', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: '@bad', to: '@Box/1', from: 'c' } },
        { output: { id: '2', ex: { '@bad': 'as Integer: got Text' }, to: 'c', from: '@Box/1' } },
        { input: { id: '3', op: '@get', to: '@Box/1', from: 'c' } },
        { output: expect.objectContaining({ id: '3', re: [5], to: 'c', from: '@Box/1' }) },
      );
    });
  });

  describe('on a call that received it', () => {
    it('an untyped bind fails before later code', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@bound', from: 'c' } },
        { output: { id: '1', ex: { '@bound': 'error' }, to: 'c' } },
      );
    });
    it('a typed bind', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@typedBound', from: 'c' } },
        { output: { id: '1', ex: { '@typedBound': 'error' }, to: 'c' } },
      );
    });
    it('a call on a constructed instance', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@ephemeral', from: 'c' } },
        { output: { id: '1', ex: { '@ephemeral': 'error' }, to: 'c' } },
      );
    });
    it('an as on the result', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@then', from: 'c' } },
        { output: { id: '1', ex: { '@then': 'error' }, to: 'c' } },
      );
    });
    it('a returned call', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@returned', from: 'c' } },
        { output: { id: '1', ex: { '@returned': 'error' }, to: 'c' } },
      );
    });
    it('another instance', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [{}, '#new'], to: '@Outer', from: 'c' } },
        { output: { id: '1', re: '#<@Outer/1>', 'bv-a': '#<@Outer>', to: 'c' } },
        { input: { id: '2', op: '@viaInstance', to: '@Outer/1', from: 'c' } },
        { output: { id: '2', ex: { '@viaInstance': 'error' }, to: 'c', from: '@Outer/1' } },
      );
    });
    it('a function in the instance', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: '@viaFunction', to: '@Box/1', from: 'c' } },
        { output: { id: '2', ex: { '@viaFunction': 'error' }, to: 'c', from: '@Box/1' } },
      );
    });
    it('a self-call in the instance', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: '@viaSelf', to: '@Box/1', from: 'c' } },
        { output: { id: '2', ex: { '@viaSelf': 'error' }, to: 'c', from: '@Box/1' } },
      );
    });
    it('leaves the caller its state', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: '@bound', from: 'c' } },
        { output: { id: '1', ex: { '@bound': 'error' }, to: 'c' } },
        { input: { id: '2', op: '@getCell', from: 'c' } },
        { output: expect.objectContaining({ id: '2', re: [11], to: 'c' }) },
      );
    });
  });

  it('a returned call that succeeds replies with its value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@returnedGood', from: 'c' } },
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

  it('a function call receives it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@viaFunction', from: 'c' } },
      { output: { id: '1', ex: { '@viaFunction': 'error' }, to: 'c' } },
    );
  });
  it('a self-call receives it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@viaSelf', from: 'c' } },
      { output: { id: '1', ex: { '@viaSelf': 'error' }, to: 'c' } },
    );
  });
});
