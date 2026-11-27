import { compileSource, createActor, expectActorBehavior } from '../helpers.js';

// An actor is a value. A declared actor (an actor with a `new`, a singleton, the
// file as `self`) named where a value goes is its address, tagged `*`: no `new`
// built it. `#<:C>` from the actor that declares it; the absolute `#<c.bv:C>` from
// anywhere else, which can't say where the declaring actor is relative to itself.
//
// `k(args)` is `$new` to the actor `k` holds and `k.x` a message to it, however `k`
// was bound: statically (resolved at compile time), as a param, or in a cell.
// See notes/actors-not-classes-2026-11-18.md.

describe('a declared actor as a value — from the file actor', () => {
  const script = `
    @N = actor {
      @pub *Integer = 1

      new = *(seed Integer) {
        @x = () -> seed
      }
    }

    C = *(n Integer) {
      @x = () -> n
    }

    s = actor {
      @get = { return 5 }
    }

    @t = actor {
      @get = { return 6 }
    }

    @plain = {
      k = C
      return k
    }

    @published = { return @N }

    @annotated = {
      k Actor = @N
      return k
    }

    @singleton = { return s }

    @publicSingleton = { return @t }

    @file = { return self }

    @named = { return n: @N, s: s, f: self }

    @same = {
      k = @N
      b Boolean = k == @N
      return b
    }

    @differ = {
      b Boolean = @N == @t
      return b
    }

    @pass = {
      j Actor = echo(@N)
      return j
    }

    echo = (k Actor) -> k

    @buildStatic = {
      k = @N
      n = k(7)
      x Integer = n.x()
      return x
    }

    @buildPrivate = {
      k = C
      c = k(4)
      x Integer = c.x()
      return x
    }

    @readStatic = {
      k = @N
      x Integer = k.pub
      return x
    }

    @buildParam = {
      x Integer = make(@N)
      return x
    }

    make = (k *(seed Integer) -> { x () -> (Integer) }) {
      n = k(4)
      x Integer = n.x()
      return x
    }

    @askParam = {
      x Integer = ask(@t)
      return x
    }

    ask = (k Actor) {
      x Integer = k.get()
      return x
    }

    @buildReturned = {
      k Actor = echo(@N)
      n = k(8)
      x Integer = n.x()
      return x
    }

    @buildInCell = {
      k *Actor = @N
      n = k(9)
      x Integer = n.x()
      return x
    }

    @askInCell = {
      k *Actor = s
      x Integer = k.get()
      return x
    }

    @takesBuilt = (b @N) {
      x Integer = b.x()
      return x
    }
  `;

  const actor = () => createActor(script, { fileName: 'c.bv' });
  const ask = (op, re, ty) => [
    { input: { id: '1', op, from: 'c' } },
    { output: { id: '1', re, ty, to: 'c' } },
  ];

  it('an actor with a `new` is its address, tagged `*`', async () => {
    await expectActorBehavior(await actor(), ...ask('plain', ['#<:~C>'], ['*']));
  });

  it('a public one', async () => {
    await expectActorBehavior(await actor(), ...ask('published', ['#<:N>'], ['*']));
  });

  it('`k Actor = @N`', async () => {
    await expectActorBehavior(await actor(), ...ask('annotated', ['#<:N>'], ['*']));
  });

  it('a singleton', async () => {
    await expectActorBehavior(await actor(), ...ask('singleton', ['#<:~s>'], ['*']));
  });

  it('a public singleton', async () => {
    await expectActorBehavior(await actor(), ...ask('publicSingleton', ['#<:t>'], ['*']));
  });

  it('the file, as `self`', async () => {
    await expectActorBehavior(await actor(), ...ask('file', ['#<:>'], ['*']));
  });

  it('in an object', async () => {
    await expectActorBehavior(await actor(), ...ask('named', [{ n: '#<:N>', s: '#<:~s>', f: '#<:>' }], [{ n: '*', s: '*', f: '*' }]));
  });

  it('compared: the same actor', async () => {
    await expectActorBehavior(await actor(), ...ask('same', [true], ['Boolean']));
  });

  it('compared: different actors', async () => {
    await expectActorBehavior(await actor(), ...ask('differ', [false], ['Boolean']));
  });

  it('passed to a function and returned', async () => {
    await expectActorBehavior(await actor(), ...ask('pass', ['#<:N>'], ['*']));
  });

  it('`k(args)`, `k` bound statically', async () => {
    await expectActorBehavior(await actor(), ...ask('buildStatic', [7], ['Integer']));
  });

  it('`k(args)`, `k` bound statically to a private one', async () => {
    await expectActorBehavior(await actor(), ...ask('buildPrivate', [4], ['Integer']));
  });

  it('`k.pub`, `k` bound statically', async () => {
    await expectActorBehavior(await actor(), ...ask('readStatic', [1], ['Integer']));
  });

  it('`k(args)`, `k` a param typed by its constructor profile', async () => {
    await expectActorBehavior(await actor(), ...ask('buildParam', [4], ['Integer']));
  });

  it('`k.x()`, `k` a param', async () => {
    await expectActorBehavior(await actor(), ...ask('askParam', [6], ['Integer']));
  });

  it('`k(args)`, `k` returned from a call', async () => {
    await expectActorBehavior(await actor(), ...ask('buildReturned', [8], ['Integer']));
  });

  it('`k(args)`, `k` in a cell', async () => {
    await expectActorBehavior(await actor(), ...ask('buildInCell', [9], ['Integer']));
  });

  it('`k.x()`, `k` in a cell', async () => {
    await expectActorBehavior(await actor(), ...ask('askInCell', [5], ['Integer']));
  });

  it('a param `b @N` takes an actor `@N` built', async () => {
    await expectActorBehavior(await actor(),
      { input: { id: '1', op: [[3], '$new'], ty: [['Integer']], to: ':N', from: 'c' } },
      { output: { id: '1', re: ['#<:N:1>'], ty: [':N'], to: 'c' } },
      { input: { id: '2', op: [['#<:N:1>'], 'takesBuilt'], ty: [[':N']], from: 'c' } },
      { output: { id: '2', re: [3], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a param `b @N` refuses `@N` itself', async () => {
    await expectActorBehavior(await actor(),
      { input: { id: '1', op: [['#<:N>'], 'takesBuilt'], ty: [['*']], from: 'c' } },
      { output: { id: '1', ex: { takesBuilt: 'unhandled' }, to: 'c' } },
    );
  });
});

describe('a declared actor as a value — from an instance', () => {
  const script = `
    @N = actor {
      @pub *Integer = 1
      prot *Integer = 2

      new = *(seed Integer) {
        @x = () -> seed
        @prot = {
          k = @N
          x Integer = k::prot
          return x
        }
        @named = { return @N }
        @own = {
          k = class
          return k
        }
        @me = { return self }
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
        @tally = actor {
          @get = { return seed }
        }
        @who = { return @tally }
      }
    }
  `;

  const built = async () => {
    const a = await createActor(script, { fileName: 'c.bv' });
    await expectActorBehavior(a,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':N', from: 'c' } },
      { output: { id: '1', re: ['#<:N:1>'], ty: [':N'], to: 'c' } },
    );
    return a;
  };
  const ask = (op, re, ty) => [
    { input: { id: '2', op, to: ':N:1', from: 'c' } },
    { output: { id: '2', re, ty, to: 'c', from: ':N:1' } },
  ];

  it('names the file\'s declared actor by its absolute address', async () => {
    await expectActorBehavior(await built(), ...ask('named', ['#<c.bv:N>'], ['*']));
  });

  it('`k = class`', async () => {
    await expectActorBehavior(await built(), ...ask('own', ['#<c.bv:N>'], ['*']));
  });

  it('`self` is the actor itself, tagged with its maker', async () => {
    await expectActorBehavior(await built(), ...ask('me', ['#<:N:1>'], [':N']));
  });

  it('`k(args)` builds one', async () => {
    await expectActorBehavior(await built(), ...ask('again', [2], ['Integer']));
  });

  it('`k.pub` reads a public class-block member', async () => {
    await expectActorBehavior(await built(), ...ask('readPub', [1], ['Integer']));
  });

  it('`k::prot`, `k` bound statically', async () => {
    await expectActorBehavior(await built(), ...ask('prot', [2], ['Integer']));
  });

  it('a singleton it declares, under its own address', async () => {
    await expectActorBehavior(await built(), ...ask('who', ['#<:N:1:tally>'], ['*']));
  });
});

describe('a declared actor as a value — errors', () => {
  it('outside the actor that declares it, it needs a fileName', () => {
    expect(() => compileSource(`
      @N = actor {
        new = *() {
          @named = { return @N }
        }
      }
    `)).toThrow('A declared actor as a value outside the actor that declares it requires a fileName');
  });

  it('`k::x` on a param — `::` needs the actor written there', () => {
    expect(() => compileSource(`
      @N = actor {
        prot *Integer = 2
        new = *() { @x = () -> 1 }
      }
      get = (k Actor) {
        x Integer = k::prot
        return x
      }
      @go = {
        x Integer = get(@N)
        return x
      }
    `)).toThrow("'k::prot' — '::' needs the actor written where it's used; 'k' is only known at runtime");
  });

  it('`k::x` bound statically is family-checked', () => {
    expect(() => compileSource(`
      @N = actor {
        prot *Integer = 2
        new = *() { @x = () -> 1 }
      }
      @get = {
        k = @N
        x Integer = k::prot
        return x
      }
    `)).toThrow("'N::prot' — a protected member of 'N' is reached only from its family");
  });

  it('annotated as one it built', () => {
    expect(() => compileSource(`
      C = *(n Integer) { @x = () -> n }
      @get = {
        k C = C
        return k
      }
    `)).toThrow("'k C = C': 'k C' takes an actor 'C' built, and 'C' itself isn't one — write 'k Actor = C'");
  });

  it('`Class` is an ordinary type name: `C` is not an actor `Class` built', () => {
    expect(() => compileSource(`
      C = *(n Integer) { @x = () -> n }
      @get = {
        k Class = C
        return k
      }
    `)).toThrow("'k Class = C': 'k Class' takes an actor 'Class' built, and 'C' itself isn't one — write 'k Actor = C'");
  });

  it('`Class` is not a type', () => {
    expect(() => compileSource(`
      echo = (c Class) -> c
      @go = { return 1 }
    `)).toThrow("'Class' is not a type");
  });
});
