import { createActor, expectActorBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// `class` — first stretch
//
// `class` denotes the class of the actor it's in (spelled `Self` before). Two forms:
//   - Type position:        @peer *class | null = null   (covered later)
//   - Expression position:  child = class(args)          (covered here)
//
// Anonymous class (file-as-class): a file with a top-level lineal `*` …`*`
// header is a class in its own right; `class` resolves to that file's class.
// `class(args)` constructs a new actor — a new actor / process — with those
// args.
//
// Driving example: recursive list reverse. Each call to @reverse on a list
// of length N spawns one child actor over the tail (length N-1) and
// composes the result. List.empty? guards the base case.
//
// Dynamic: `class` resolves to the runtime class of the receiver. With
// the file-as-class shape and no inheritance involved, the choice doesn't
// bite here — but the test is written so it would still pass under dynamic
// resolution if a subclass were to override @reverse.
// ═══════════════════════════════════════════════════════════════════════════════

const REVERSE_SCRIPT = `
*
  list List
*

@reverse = {
  if (List.empty?(list)) { return reversed: [] }
  first Anything = List.first(list)
  rest List = List.from(list, 1)
  child class = class(rest)
  :reversed List = child.reverse()
  return reversed: List.append(reversed, first)
}
`;

// A factory file is built by its host, so `class` in it always has a class to
// name. (In a plain file, which nothing builds, `class` is an error.) There is no other case worth a
// negative test today — if subclasses or detached lambda contexts later
// surface a real edge, add tests for them then.

describe('`class` — recursive list reverse', () => {
  it('reverses an empty list (base case, no recursion)', async () => {
    const actor = await createActor(REVERSE_SCRIPT, { constructorArgs: [[]] });
    await expectActorBehavior(actor,
      { input: { id: '1', op: 'reverse', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', re: [{ reversed: [] }], to: 'caller' }) },
    );
  });

  it('reverses a single-element list (one level of class recursion)', async () => {
    const actor = await createActor(REVERSE_SCRIPT, { constructorArgs: [[42]] });
    await expectActorBehavior(actor,
      { input: { id: '1', op: 'reverse', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', re: [{ reversed: [42] }], to: 'caller' }) },
    );
  });

  it('reverses a multi-element list (deep class recursion)', async () => {
    const actor = await createActor(REVERSE_SCRIPT, { constructorArgs: [[1, 2, 3]] });
    await expectActorBehavior(actor,
      { input: { id: '1', op: 'reverse', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', re: [{ reversed: [3, 2, 1] }], to: 'caller' }) },
    );
  });
});
