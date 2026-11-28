import { expectBehavior } from '../helpers.js';

// A list sent as an arg arrives as a list: the handler's arrival check reads the
// wire array into the List type (src/as_check.js checkParams), nested lists too.

describe('a list arg from the wire', () => {
  const script = `
    @sum = (xs List[Integer]) {
      r Integer = reduce(0, xs) (acc Integer, x Integer) { acc + x }
      return r
    }
    @size = (xs List[Text]) -> List.size(xs)
    @echo = (xs List[Text]) -> xs
    @flat = (xss List[List[Integer]]) -> List.flatten(xss)
    @innerSize = (xss List[List[Integer]]) -> List.size(List.first(xss))
  `;

  it('is a list to reduce over', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[[1, 2, 3]], 'sum'], ty: [['List[Integer]']], from: 'c' } },
      { output: { id: '1', re: [6], ty: ['Integer'], to: 'c' } },
    );
  });

  it('is a list to a List function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[['a', 'b', 'c']], 'size'], ty: [['List[Text]']], from: 'c' } },
      { output: { id: '1', re: [3], ty: ['Integer'], to: 'c' } },
    );
  });

  it('goes back out as the list it came in as', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[['a', 'b']], 'echo'], ty: [['List[Text]']], from: 'c' } },
      { output: { id: '1', re: [['a', 'b']], ty: ['List[Text]'], to: 'c' } },
    );
  });

  it('nested: each inner list is a list', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[[[1, 2], [3]]], 'flat'], ty: [['List[List[Integer]]']], from: 'c' } },
      { output: { id: '1', re: [[1, 2, 3]], ty: ['List[Integer]'], to: 'c' } },
      { input: { id: '2', op: [[[[4, 5, 6], [7]]], 'innerSize'], ty: [['List[List[Integer]]']], from: 'c' } },
      { output: { id: '2', re: [3], ty: ['Integer'], to: 'c' } },
    );
  });
});
