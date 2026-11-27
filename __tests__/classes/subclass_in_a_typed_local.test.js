import { expectBehavior } from '../helpers.js';

// A typed local takes an instance of the declared class or of a subclass, as a
// typed param does. The refusals, and the same check on cells, are in
// subclass_consumption.test.js.

const script = `
  T = *(x Integer) { @a = () -> x }
  U = T ^ *(x Integer, y Integer) { super(x) }
  @local = { t T = U(2, 3); x Integer = t.a(); return x }
`;

describe('a subclass instance in a typed local', () => {
  it('a typed local holds a subclass instance', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'local', from: 'c' } }, { output: { id: '1', ty: ['Integer'], re: [2], to: 'c' } });
  });
});
