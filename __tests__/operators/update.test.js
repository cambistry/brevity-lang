import { expectBehavior } from '../helpers.js';

describe('update operator (<|)', () => {
  const script = `
    Person
      <>
      =
      name *Text = "anonymous"

      update = |name: (n) Text| name <- n .

      @get
        =
        -> name: name as Text

      .

    Store
      <>
      =
      p *Integer = 0
      label *Text = ""

      update
        =
        val Integer
        label: (l) Text
        =
        p <- val
        label <- l
        .

      @pos
        =
        -> value: p as Integer

      @named
        =
        -> value: label as Text

      .

    @singleNamed
      =
      a = *Person()
      a <| name: "Somebody"
      :name = a.get()
      -> :name as Text

    @multiArg
      =
      s = *Store()
      s <| 42, label: "forty-two"
      :value = s.pos()
      -> :value as Integer
  `;

  it('update with named param — actor receives via update handler', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@singleNamed', from: 'c' } },
      { output: { id: '1', 'bv-a': { name: 'Text' }, re: { name: 'Somebody' }, to: 'c' } },
    );
  });

  it('update with positional + named — multi-arg dispatch', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@multiArg', from: 'c' } },
      { output: { id: '2', 'bv-a': { value: 'Integer' }, re: { value: 42 }, to: 'c' } },
    );
  });
});
