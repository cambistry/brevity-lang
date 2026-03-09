import compile from '../index.js';

describe('Type | null syntax', () => {
  it('Integer | null is a valid type (no throw)', () => {
    expect(() => compile([
      'on test()',
      '  x : Integer | null = null',
      '  reply result: 0 : Integer',
    ].join('\n'))).not.toThrow();
  });

  it('Text | null is a valid type (no throw)', () => {
    expect(() => compile([
      'on test()',
      '  x : Text | null = null',
      '  reply result: 0 : Integer',
    ].join('\n'))).not.toThrow();
  });

  it('List of Integers | null is a valid type (no throw)', () => {
    expect(() => compile([
      'on test()',
      '  x : List of Integers | null = null',
      '  reply result: 0 : Integer',
    ].join('\n'))).not.toThrow();
  });

  it('Integers | null — plural standalone still throws', () => {
    expect(() => compile([
      'on test()',
      '  x : Integers | null = null',
      '  reply result: 0 : Integer',
    ].join('\n'))).toThrow(/'Integers' is not a valid standalone type/);
  });
});
