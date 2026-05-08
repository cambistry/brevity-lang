import { expectBehavior } from '../helpers.js';

describe('test.update — single named param via update handler', () => {
  const script = `
      name *Text = "anonymous"

      update = (name: (n) Text) ->  name <- n .

      @get = -> :name
  `;

  it('updates value through `update` dispatch', async () => {
    await expectBehavior(script,
      { input: { test: { update: { name: 'Alice' } }, from: 't' } },
      { input: { id: '1', test: { get: 'name' }, from: 't' } },
      { output: { id: '1', 'bv-a': 'Text', re: 'Alice', to: 't' } },
    );
  });

  it('overwrites previous value', async () => {
    await expectBehavior(script,
      { input: { test: { update: { name: 'Bob' } }, from: 't' } },
      { input: { test: { update: { name: 'Carol' } }, from: 't' } },
      { input: { id: '1', test: { get: 'name' }, from: 't' } },
      { output: { id: '1', 'bv-a': 'Text', re: 'Carol', to: 't' } },
    );
  });
});

describe('test.update — mixed positional + named args', () => {
  const script = `
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

      @getP = -> :p
      @getLabel = -> :label
  `;

  it('updates with positional + named args', async () => {
    await expectBehavior(script,
      { input: { test: { update: [11, { label: 'eleven' }] }, from: 't' } },
      { input: { id: '1', test: { get: 'p' }, from: 't' } },
      { input: { id: '2', test: { get: 'label' }, from: 't' } },
      { output: { id: '1', 'bv-a': 'Integer', re: 11, to: 't' } },
      { output: { id: '2', 'bv-a': 'Text', re: 'eleven', to: 't' } },
    );
  });
});

describe('test.update — then mutate with public function', () => {
  const script = `
      count *Integer = 0

      update = (n Integer) ->  count <- n .

      @inc = {
        count <- count + 1
        -> :count
      }

      @get = -> :count
  `;

  it('update state then increment', async () => {
    await expectBehavior(script,
        { input: { test: { update: 10 }, from: 't' } },
        { input: { id: '1', test: { op: '@inc' }, from: 't' } },
        { input: { id: '2', test: { get: 'count' }, from: 't' } },
        { output: expect.objectContaining({ id: '1', re: { count: 11 } }) },
        { output: { id: '2', 'bv-a': 'Integer', re: 11, to: 't' } },
    );
  });
});

// Cross-target: child actor update handler (works on all targets)
describe('test.update — child actor via normal dispatch', () => {
  const script = `
      Person =
        *
        =
        name *Text = "anonymous"
        update = (name: (n) Text) ->  name <- n .
        @get = -> name: name
        .
      end#Person

      @updateAndGet
        =
        p = *Person()
        p <| name: "Alice"
        :name Text = p.get()
        -> :name
  `;

  it('update handler works through child dispatch', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@updateAndGet', from: 'c' } },
      { output: { id: '1', 'bv-a': { name: 'Text' }, re: { name: 'Alice' }, to: 'c' } },
    );
  });
});
