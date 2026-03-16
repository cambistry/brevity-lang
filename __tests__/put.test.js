import { expectReply } from './helpers.js';

describe('actor put operator (<-)', () => {

  it('single positional put — actor receives via on <-', async () => {
    const source = `
      actor Box
        init(seed : Integer)
          $value : Integer = seed

        on <- (n : Integer)
          $value = n

        on get()
          -> value: $value : Integer
      end#Box

      on test()
        ref b = Box(0)
        b <- 42
        :value = b.get()
        -> :value : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { value: 'Integer' },
        re: { value: 42 },
        to: 'caller',
      },
    });
  });

  it('positional + named put', async () => {
    const source = `
      actor Store
        init(seed : Integer)
          $p : Integer = seed
          $label : Text = ""

        on <- (val : Integer, label: l : Text)
          $p = val
          $label = l

        on pos()
          -> value: $p : Integer

        on named()
          -> value: $label : Text
      end#Store

      on test()
        ref s = Store(0)
        s <- 11, label: "eleven"
        :value = s.pos()
        -> :value : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { value: 'Integer' },
        re: { value: 11 },
        to: 'caller',
      },
    });
  });

  it('put without as clause — state persists via getter', async () => {
    const source = `
      actor Counter
        init(seed : Integer)
          $count : Integer = seed

        on <- (n : Integer)
          $count = n

        on get()
          -> count: $count : Integer
      end#Counter

      on test()
        ref c = Counter(0)
        c <- 99
        :count = c.get()
        -> :count : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { count: 'Integer' },
        re: { count: 99 },
        to: 'caller',
      },
    });
  });

  it('scalar ref put backward compat — ref x <- 5', async () => {
    const source = `
      on test()
        ref x : Integer = 0
        x <- 5
        -> result: x : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 5 },
        to: 'caller',
      },
    });
  });
});
