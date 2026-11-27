import { expectBehavior, compileSource } from '../helpers.js';

// List's `map`, `filter`, `find`, `sum`, in the shape of `over`: the list, then the
// function, in the parens or as a trailing block. Destructured from List they're
// called by name.
describe('List.map, filter, find, sum', () => {
  const script = `
    :filter, :find, :map, :sum = List
    big = (n Integer) -> n > 2

    @mapped = () {
      xs List of Integers = [1, 2, 3]
      v List of Integers = List.map(xs) (x) { x * 10 }
      return v
    }
    @filtered = () {
      xs List of Integers = [1, 2, 3, 4]
      v List of Integers = filter(xs) (x) { x % 2 == 0 }
      return v
    }
    @byRef = () {
      xs List of Integers = [1, 2, 3, 4]
      v List of Integers = filter(xs, &big)
      return v
    }
    @found = (k Integer) {
      xs List of Integers = [3, 8, 12]
      v Integer | null = find(xs) (x) { x > k }
      return v
    }
    @summed = () {
      xs List of Integers = [1, 2, 3, 4]
      v Integer = sum(xs)
      return v
    }
    @ofCell = () {
      cells *List of Integers = [5, 6]
      v Integer = sum(map(cells) (x) { x + 1 })
      return v
    }
  `;

  it('map and filter, with a block and a reference', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'mapped', from: 'c' } },
      { output: { id: '1', re: [[10, 20, 30]], ty: ['List of Integers'], to: 'c' } },
      { input: { id: '2', op: 'filtered', from: 'c' } },
      { output: { id: '2', re: [[2, 4]], ty: ['List of Integers'], to: 'c' } },
      { input: { id: '3', op: 'byRef', from: 'c' } },
      { output: { id: '3', re: [[3, 4]], ty: ['List of Integers'], to: 'c' } },
    );
  });

  it('find: the first match, or null', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5], 'found'], ty: [['Integer']], from: 'c' } },
      { output: { id: '1', re: [8], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: [[20], 'found'], ty: [['Integer']], from: 'c' } },
      { output: { id: '2', re: [null], ty: ['null'], to: 'c' } },
    );
  });

  it('sum, of a value and of a cell', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'summed', from: 'c' } },
      { output: { id: '1', re: [10], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: 'ofCell', from: 'c' } },
      { output: { id: '2', re: [13], ty: ['Integer'], to: 'c' } },
    );
  });
});

describe('List.map, filter, find, sum — compile errors', () => {
  it('a map whose value is unused', () => {
    expect(() => compileSource(`
      @g = () {
        xs List of Integers = [1, 2]
        List.map(xs) (x) { x + 1 }
        return 1
      }
    `)).toThrow("A 'map' whose value is unused: 'over' is the form for effects");
  });

  it('sum takes no function', () => {
    expect(() => compileSource(`
      @g = () {
        xs List of Integers = [1, 2]
        v Integer = List.sum(xs, &xs)
        return v
      }
    `)).toThrow("'sum' takes a list of numbers, and no function");
  });
});
