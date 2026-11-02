import { expectBehavior } from '../helpers.js';

// Returning a call on an actor waits for its reply, as a bind does.

describe('returning a call on an instance', () => {
  const script = `
    @Box = *{
      n *Integer = 5
      @one = { return 1 }
      @two = { return 1, 2 }
      @named = { return a: 1 }
      @plus = (i Integer) { return i + 1 }
      @get = { return n }
      @inc! = { n <- n + 1 }
    }

    @sole = {
      b = Box()
      return b.one()
    }
    @constructed = {
      return Box().one()
    }
    @several = {
      b = Box()
      return b.two()
    }
    @wholeNamed = {
      b = Box()
      return b.named()
    }
    @withArg = {
      b = Box()
      return b.plus(4)
    }
    @withParam = (t Text) {
      b = Box()
      return b.one()
    }
    @chained = {
      b = Box()
      return b.inc!().get()
    }
    @oneOfTwo = {
      b = Box()
      return b.one(), 2
    }
    @namedField = {
      b = Box()
      return z: b.one()
    }
    @tail = {
      b = Box()
      b.one()
    }
    @object = {
      b = Box()
      x = b.one() as Object
      return x
    }
    @objectNamed = {
      b = Box()
      x = b.named() as Object
      return x
    }
    @typed = {
      b = Box()
      return b.one() as Integer
    }
  `;

  it('replies with its value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@sole', from: 'c' } },
      { output: { id: '1', re: [1], to: 'c' } },
    );
  });
  it('on an instance constructed in place', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@constructed', from: 'c' } },
      { output: { id: '1', re: [1], to: 'c' } },
    );
  });
  it('keeps several positionals', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@several', from: 'c' } },
      { output: { id: '1', re: [1, 2], to: 'c' } },
    );
  });
  it('keeps a named reply', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@wholeNamed', from: 'c' } },
      { output: { id: '1', re: { a: 1 }, to: 'c' } },
    );
  });
  it('passes args', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@withArg', from: 'c' } },
      { output: { id: '1', re: [5], to: 'c' } },
    );
  });
  it('tags the reply with nothing from the request', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [['x'], '@withParam'], 'bv-a': [['Text']], from: 'c' } },
      { output: { id: '1', re: [1], to: 'c' } },
    );
  });
  it('follows a chain', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@chained', from: 'c' } },
      { output: { id: '1', re: [6], to: 'c' } },
    );
  });
  it('takes the sole value beside another field', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@oneOfTwo', from: 'c' } },
      { output: { id: '1', re: [1, 2], to: 'c' } },
    );
  });
  it('takes the sole value in a named field', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@namedField', from: 'c' } },
      { output: { id: '1', re: { z: 1 }, to: 'c' } },
    );
  });
  it('as a tail expression', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@tail', from: 'c' } },
      { output: { id: '1', re: [1], to: 'c' } },
    );
  });
  it('bound as Object first', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@object', from: 'c' } },
      { output: { id: '1', re: [1], to: 'c' } },
    );
  });
  it('bound as Object first, named', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@objectNamed', from: 'c' } },
      { output: { id: '1', re: { a: 1 }, to: 'c' } },
    );
  });
  it('with an as', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@typed', from: 'c' } },
      { output: { id: '1', re: [1], 'bv-a': ['Integer'], to: 'c' } },
    );
  });
});

describe('a call on an instance inside a branch', () => {
  const failing = `
    @Box = *{
      mixed = (b Boolean) {
        if b { return 1 }
        return "x"
      }
      @bad = { return mixed(false) as Integer }
    }

    @go = (c Boolean) {
      b = Box()
      if c { return b.bad() }
      return 9
    }
  `;
  const script = `
    @Box = *{
      @one = { return 1 }
    }

    @returned = (c Boolean) {
      b = Box()
      if c { return b.one() }
      return 9
    }
    @bound = (c Boolean) {
      b = Box()
      if c {
        r = b.one()
        return r
      }
      return 9
    }
    @other = (c Boolean) {
      b = Box()
      if c { return 9 }
      return b.one()
    }
    @nested = (c Boolean) {
      b = Box()
      if c {
        if c { return b.one() }
      }
      return 9
    }
    @rebound = (c Boolean) {
      b = Box()
      r = 5
      if c {
        s = b.one()
        return s, r
      }
      return r
    }
    @Outer = *{
      @viaBranch = (c Boolean) {
        b = Box()
        if c { return b.one() }
        return 9
      }
    }
  `;

  it('returned', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@returned'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', re: [1], to: 'c' } },
    );
  });
  it('bound', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@bound'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1], to: 'c' }) },
    );
  });
  it('the branch not taken', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@returned'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', re: [9], 'bv-a': ['Integer'], to: 'c' } },
    );
  });
  it('after the branch', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@other'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', re: [1], to: 'c' } },
    );
  });
  it('tags the other path', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@other'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', re: [9], 'bv-a': ['Integer'], to: 'c' } },
    );
  });
  it('in a nested branch', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@nested'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1], to: 'c' }) },
    );
  });
  it('reads a local from before the branch', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@rebound'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1, 5], to: 'c' }) },
    );
  });
  it('in a class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{}, '#new'], to: '@Outer', from: 'c' } },
      { output: { id: '1', re: '#<@Outer/1>', 'bv-a': '#<@Outer>', to: 'c' } },
      { input: { id: '2', op: [[true], '@viaBranch'], 'bv-a': [['Boolean']], to: '@Outer/1', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: [1], to: 'c', from: '@Outer/1' }) },
    );
  });
  it('a failure in the call', async () => {
    await expectBehavior(failing,
      { input: { id: '1', op: [[true], '@go'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', ex: { '@go': 'error' }, to: 'c' } },
    );
  });
});

describe('returning a call on a remote', () => {
  const script = `
    *
      "svc": Svc { t () -> (Integer) }
    *
    @go = {
      return Svc.t()
    }
  `;

  it('waits for the reply', async () => {
    await expectBehavior(script,
      { input: { id: '99', op: '@go', from: 'c' } },
      { output: expect.objectContaining({ op: '@t', to: 'Svc' }) },
      { input: { id: '1', re: [7], 'bv-a': ['Integer'] } },
      { output: expect.objectContaining({ id: '99', re: [7], to: 'c' }) },
    );
  });
});
