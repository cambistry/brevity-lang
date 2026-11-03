import { expectBehavior } from '../helpers.js';

// A file-level function with an untyped param is generic: its param's type
// is only known at the call site. Arithmetic and comparison on it must still
// work, whichever numeric type the caller passes.

describe('untyped param arithmetic in a file-level function', () => {
  const script = `
    double = (n) { n * 2 }
    big = (n) { n > 10 }
    cube = (n) { n ** 3 }

    @test = {
      result Integer = double(21)
      return :result
    }

    @testDecimal = {
      result Decimal = double(1.25)
      return :result
    }

    @testPower = {
      result Integer = cube(3)
      return :result
    }

    @testCompare = {
      result Boolean = big(11)
      return :result
    }
  `;

  it('doubles an Integer argument', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('doubles a Decimal argument', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testDecimal', from: 'c' } },
      { output: { id: '2', 'ty': { result: 'Decimal' }, re: { result: 2.5 }, to: 'c' } },
    );
  });

  it('raises an untyped argument to a power', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@testPower', from: 'c' } },
      { output: { id: '4', 'ty': { result: 'Integer' }, re: { result: 27 }, to: 'c' } },
    );
  });

  it('compares an untyped argument', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@testCompare', from: 'c' } },
      { output: { id: '3', 'ty': { result: 'Boolean' }, re: { result: true }, to: 'c' } },
    );
  });
});
