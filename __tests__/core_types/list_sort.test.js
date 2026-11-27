import { expectBehavior, compileSource } from '../helpers.js';

// `List.sort(xs)` sorts in natural order; with a function, by it: one param is a
// key, sorted in natural order, and two a comparator, true when the first sorts
// before the second. Stable: equal ones keep their order.
describe('List.sort by a function', () => {
  const script = `
    :sort = List
    larger = (a Integer, b Integer) -> a > b

    @natural = () {
      xs List[Integer] = [3, 1, 2]
      v List[Integer] = sort(xs)
      return v
    }
    @byKey = () {
      xs List[Text] = ["bb", "a", "cc", "d"]
      v List[Text] = sort(xs) (t Text) { Text.size(t) }
      return v
    }
    @descending = () {
      xs List[Integer] = [3, 1, 4, 1, 5]
      v List[Integer] = sort(xs) (a Integer, b Integer) { a > b }
      return v
    }
    @byRef = () {
      xs List[Integer] = [2, 9, 4]
      v List[Integer] = List.sort(xs, &larger)
      return v
    }
    @stable = () {
      xs List[Text] = ["b2", "a1", "b1", "a2"]
      v List[Text] = sort(xs) (s Text, t Text) { Text.take(s, 1) < Text.take(t, 1) }
      return v
    }
  `;

  it('natural order, and by a key', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'natural', from: 'c' } },
      { output: { id: '1', re: [[1, 2, 3]], ty: ['List[Integer]'], to: 'c' } },
      { input: { id: '2', op: 'byKey', from: 'c' } },
      { output: { id: '2', re: [['a', 'd', 'bb', 'cc']], ty: ['List[Text]'], to: 'c' } },
    );
  });

  it('by a comparator, written or referenced', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'descending', from: 'c' } },
      { output: { id: '1', re: [[5, 4, 3, 1, 1]], ty: ['List[Integer]'], to: 'c' } },
      { input: { id: '2', op: 'byRef', from: 'c' } },
      { output: { id: '2', re: [[9, 4, 2]], ty: ['List[Integer]'], to: 'c' } },
    );
  });

  it('stable: equal ones keep their order', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'stable', from: 'c' } },
      { output: { id: '1', re: [['a1', 'a2', 'b2', 'b1']], ty: ['List[Text]'], to: 'c' } },
    );
  });
});

describe('List.sort by a function — compile errors', () => {
  it('a function of three params', () => {
    expect(() => compileSource(`
      @g = () {
        xs List[Integer] = [1]
        v List[Integer] = List.sort(xs) (a Integer, b Integer, c Integer) { a > b }
        return v
      }
    `)).toThrow("'sort''s function takes one value (a key) or two (whether the first sorts before the second)");
  });
});
