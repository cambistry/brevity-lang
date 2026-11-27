import { expectBehavior } from '../helpers.js';

describe('test.op — runtime', () => {
  const script = `
    // test.op — public function
    x *Integer = 0

    @inc!
      =
      x <- x + 1
      return :x

    @get = () -> :x

    // test.op — private function
    double
      =
      n Integer
      =
      return n * 2

    @call
      =
      n: Integer
      =
      result Integer = double(n)
      return :result

    // test.op — with args (shares x)
    @add!
      =
      n: Integer
      =
      x <- x + n
      return :x

    // test.op — bypasses schema validation
    @echo = (msg: Text) -> :msg
  `;

  it('test.op — public function — dispatches public function', async () => {
    await expectBehavior(script,
      { input:  { id: '1', test: { op: 'inc!' }, from: 't' } },
      { input:  { id: '2', test: { op: 'inc!' }, from: 't' } },
      { input:  { id: '3', test: { op: 'get' }, from: 't' } },
      { output: expect.objectContaining({ id: '1', re: [{ x: 1 }] }) },
      { output: expect.objectContaining({ id: '2', re: [{ x: 2 }] }) },
      { output: expect.objectContaining({ id: '3', re: [{ x: 2 }] }) },
    );
  });

  it('test.op — private function — dispatches private function directly', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { op: [[5], '~double'] }, from: 't' } },
      { output: expect.objectContaining({ id: '1', re: [10] }) },
    );
  });

  it('test.op — with args — passes args to op', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { op: [[{ n: 3 }], 'add!'] }, from: 't' } },
      { input: { id: '2', test: { op: [[{ n: 7 }], 'add!'] }, from: 't' } },
      { input: { id: '3', test: { get: '~x' }, from: 't' } },
      { output: expect.objectContaining({ id: '1', re: [{ x: 3 }] }) },
      { output: expect.objectContaining({ id: '2', re: [{ x: 10 }] }) },
      { output: { id: '3', 'ty': ['Integer'], re: [10], to: 't' } },
    );
  });

  it('test.op — bypasses schema validation — no ty required', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { op: [[{ msg: 'hello' }], 'echo'] }, from: 't' } },
      { output: expect.objectContaining({ id: '1', re: [{ msg: 'hello' }] }) },
    );
  });
});
