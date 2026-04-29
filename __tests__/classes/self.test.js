import { createActor, expectActorBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Self — first stretch
//
// Self denotes the enclosing class. Two complementary forms:
//   - Type position:        @peer Self | null! = null   (covered later)
//   - Expression position:  child = Self(args)          (covered here)
//
// Anonymous class (file-as-class): a file with a top-level `< params > =`
// header is a constructor in its own right; `Self` resolves to that file's
// class. `Self(args)` constructs a new instance — a new actor / process —
// with those args.
//
// Driving example: recursive list reverse. Each call to @reverse on a list
// of length N spawns one child actor over the tail (length N-1) and
// composes the result. List.empty? guards the base case.
//
// Dynamic Self: `Self` resolves to the runtime class of the receiver. With
// the file-as-class shape and no inheritance involved, the choice doesn't
// bite here — but the test is written so it would still pass under dynamic
// resolution if a subclass were to override @reverse.
// ═══════════════════════════════════════════════════════════════════════════════

const REVERSE_SCRIPT = `
< list List >
=

@reverse = {
  if (List.empty?(list)) { -> reversed: [] }
  first Anything = List.first(list)
  rest List = List.from(list, 1)
  child Self = Self(rest)
  :reversed List = child.reverse()
  -> reversed: List.append(reversed, first)
}
`;

// Every brevity file is itself a class, so Self always has an enclosing
// class to resolve to. There is no "Self outside a class" case worth a
// negative test today — if subclasses or detached lambda contexts later
// surface a real edge, add tests for them then.

describe('Self — recursive list reverse', () => {
  it('reverses an empty list (base case, no recursion)', async () => {
    const actor = await createActor(REVERSE_SCRIPT, { constructorArgs: [[]] });
    await expectActorBehavior(actor,
      { input: { id: '1', op: '@reverse', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', re: { reversed: [] }, to: 'caller' }) },
    );
  });

  it('reverses a single-element list (one level of Self recursion)', async () => {
    const actor = await createActor(REVERSE_SCRIPT, { constructorArgs: [[42]] });
    await expectActorBehavior(actor,
      { input: { id: '1', op: '@reverse', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', re: { reversed: [42] }, to: 'caller' }) },
    );
  });

  it('reverses a multi-element list (deep Self recursion)', async () => {
    const actor = await createActor(REVERSE_SCRIPT, { constructorArgs: [[1, 2, 3]] });
    await expectActorBehavior(actor,
      { input: { id: '1', op: '@reverse', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', re: { reversed: [3, 2, 1] }, to: 'caller' }) },
    );
  });
});
