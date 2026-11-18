import { compileSource, createActor, expectActorBehavior } from '../helpers.js';

// A class as a value: `k = C`, `k = @C`, `k = class`. Its value is the class's
// address, tagged `Class`: `#<:C>` from the file actor, which declares it, and
// the absolute `#<c.bv:C>` from an instance, which can't say where the file
// actor is relative to itself (as `Self` as a value can't). A name bound to a
// class builds it (`k(args)`) and reaches its public members (`k.pub`).
// See notes/class-scope-and-inheritance-2026-11-16.md.

const script = `
  @N = actor {
    @pub *Integer = 1

    new = (seed Integer) *{
      @x = -> seed
      @named = {
        k = @N
        return k
      }
      @own = {
        k = class
        return k
      }
      @again = {
        k = class
        n = k(seed + 1)
        x Integer = n.x()
        return x
      }
      @readPub = {
        k = @N
        x Integer = k.pub
        return x
      }
    }
  }

  C = (n Integer) *{
    @x = -> n
  }

  @plain = {
    k = C
    return k
  }

  @published = {
    k = @N
    return k
  }

  @annotated = {
    k Class = @N
    return k
  }

  @direct = { return @N }

  @build = {
    k = C
    c = k(4)
    x Integer = c.x()
    return x
  }

  @buildPublished = {
    k = @N
    n = k(7)
    x Integer = n.x()
    return x
  }

  @readPub = {
    k = @N
    x Integer = k.pub
    return x
  }

  @pass = {
    k = @N
    j Class = echo(k)
    return j
  }

  echo = (c Class) -> c
`;

const actor = () => createActor(script, { fileName: 'c.bv' });
const ask = (op, re, ty, id = '1') => [
  { input: { id, op, from: 'c' } },
  { output: { id, re, ty, to: 'c' } },
];

describe('a class as a value — from the file actor', () => {
  it('`k = C` replies with the class\'s address, tagged Class', async () => {
    await expectActorBehavior(await actor(), ...ask('plain', ['#<:~C>'], ['Class']));
  });

  it('`k = @C`', async () => {
    await expectActorBehavior(await actor(), ...ask('published', ['#<:N>'], ['Class']));
  });

  it('`k Class = @C`', async () => {
    await expectActorBehavior(await actor(), ...ask('annotated', ['#<:N>'], ['Class']));
  });

  it('`return @C`', async () => {
    await expectActorBehavior(await actor(), ...ask('direct', ['#<:N>'], ['Class']));
  });

  it('`k(args)` builds one', async () => {
    await expectActorBehavior(await actor(), ...ask('build', [4], ['Integer']));
  });

  it('`k(args)` builds a published class', async () => {
    await expectActorBehavior(await actor(), ...ask('buildPublished', [7], ['Integer']));
  });

  it('`k.pub` reads a public class-block member', async () => {
    await expectActorBehavior(await actor(), ...ask('readPub', [1], ['Integer']));
  });

  it('passed to a function and returned', async () => {
    await expectActorBehavior(await actor(), ...ask('pass', ['#<:N>'], ['Class']));
  });
});

describe('a class as a value — from an instance', () => {
  const built = async () => {
    const a = await actor();
    await expectActorBehavior(a,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':N', from: 'c' } },
      { output: { id: '1', re: '#<:N:1>', ty: ':N', to: 'c' } },
    );
    return a;
  };
  const askN = (op, re, ty) => [
    { input: { id: '2', op, to: ':N:1', from: 'c' } },
    { output: { id: '2', re, ty, to: 'c', from: ':N:1' } },
  ];

  it('`k = @C` replies with the class\'s absolute address', async () => {
    await expectActorBehavior(await built(), ...askN('named', ['#<c.bv:N>'], ['Class']));
  });

  it('`k = class`', async () => {
    await expectActorBehavior(await built(), ...askN('own', ['#<c.bv:N>'], ['Class']));
  });

  it('`k(args)` builds one', async () => {
    await expectActorBehavior(await built(), ...askN('again', [2], ['Integer']));
  });

  it('`k.pub` reads a public class-block member', async () => {
    await expectActorBehavior(await built(), ...askN('readPub', [1], ['Integer']));
  });
});

describe('a class as a value — errors', () => {
  it('outside the file actor, it needs a fileName', () => {
    expect(() => compileSource(`
      @N = actor {
        new = () *{
          @named = {
            k = @N
            return k
          }
        }
      }
    `)).toThrow('A class as a value outside the file actor requires a fileName');
  });

  it('`k::x` — `::` isn\'t reached through a value', () => {
    expect(() => compileSource(`
      @N = actor {
        prot *Integer = 2
        new = () *{ @x = -> 1 }
      }
      @get = {
        k = @N
        x Integer = k::prot
        return x
      }
    `)).toThrow("'k::prot' — '::' names a member of the class written there, so it isn't reached through a value: write '@N::prot'");
  });

  it('annotated as an instance', () => {
    expect(() => compileSource(`
      C = (n Integer) *{ @x = -> n }
      @get = {
        k C = C
        return k
      }
    `)).toThrow("'k C = C': a class's type is 'Class' ('k C' is an actor of 'C')");
  });

  it('held in a cell', () => {
    expect(() => compileSource(`
      C = (n Integer) *{ @x = -> n }
      @get = {
        k *Class = C
        return 1
      }
    `)).toThrow("'k': a class is bound, not held in a cell — write 'k = C'");
  });
});
