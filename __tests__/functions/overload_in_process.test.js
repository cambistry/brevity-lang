import { expectBehavior, createActor, expectActorBehavior } from '../helpers.js';

// An overloaded call is picked by its message's tags when it has them, whoever sent
// it, and by its values when it hasn't: an in-process call (a parent to its child,
// a file to itself) carries values only. A typed value carries its type, and an
// in-process actor its class, so a value picks between clauses that differ only by
// a type or a class param.

describe('an in-process call to an overload', () => {
  const script = `
    type Point(Integer, Integer)
    type Box(Integer)
    T = *(n Integer) {
      @put = (p Point) -> 1
      @put << (b Box) -> 2
    }
    A = *{ @k = () -> 1 }
    B = *{ @k = () -> 2 }
    U = *{
      @who = (a A) -> 1
      @who << (b B) -> 2
    }
    pick = (n Integer) { return "a" }
    pick << (n Text) { return 1 }
    @pk = (n Integer) { return "a" }
    @pk << (n Text) { return 1 }

    @byType = {
      t = T(1)
      p Integer = t.put(Point(1, 2))
      b Integer = t.put(Box(3))
      return p, b
    }
    @byClass = {
      u = U()
      a Integer = u.who(A())
      b Integer = u.who(B())
      return a, b
    }
    @own = (v Text) {
      x Integer = pick(v)
      y Integer = @pk(v)
      return x, y
    }
  `;

  it('from a parent, by a type param', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'byType', from: 'c' } },
      { output: { id: '1', re: [1, 2], ty: ['Integer', 'Integer'], to: 'c' } },
    );
  });

  it('from a parent, by a class param', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'byClass', from: 'c' } },
      { output: { id: '1', re: [1, 2], ty: ['Integer', 'Integer'], to: 'c' } },
    );
  });

  it('from the file to its own overloads', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [['z'], 'own'], ty: [['Text']], from: 'c' } },
      { output: { id: '1', re: [1, 1], ty: ['Integer', 'Integer'], to: 'c' } },
    );
  });
});

describe('an in-process call to an overload of a class() actor', () => {
  const script = `
    *
      n Integer
    *
    type Point(Integer, Integer)
    type Box(Integer)
    @put = (p Point) -> 1
    @put << (b Box) -> 2
    @viaOther = {
      other class = class(2)
      p Integer = other.put(Point(1, 2))
      b Integer = other.put(Box(3))
      return p, b
    }
  `;

  it('is picked by its values', async () => {
    const actor = await createActor(script, { constructorArgs: [1] });
    await expectActorBehavior(actor,
      { input: { id: '1', op: 'viaOther', from: 'c' } },
      { output: { id: '1', re: [1, 2], ty: ['Integer', 'Integer'], to: 'c' } },
    );
  });
});
