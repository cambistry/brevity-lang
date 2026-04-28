import { extract } from '../../index.js';
import { expectBehavior, compileSource } from '../helpers.js';

// Slice 11 of types-implementation-plan-2026-04-27: optionality. The `?`
// field qualifier marks a field as optional. The `(expr)?` postfix returns
// Boolean (true when expr resolves to a non-null value). The `??` infix is
// a fallback operator. Positional construction allows omitting trailing
// optional fields.

describe('shape optionality — declarations', () => {
  it('parses ? prefix as the optional field marker', () => {
    const { ast } = extract(`
      ::Game = (
        ? started Boolean,
        ? turn: Integer
      )
    `);
    const fields = ast.types[0].fields;
    expect(fields[0].optional).toBe(true);
    expect(fields[1].optional).toBe(true);
    expect(fields[1].named).toBe(true);
  });
});

describe('shape optionality — construction', () => {
  it('allows positional construction with all optionals', () => {
    expect(() => compileSource(`
      ::Game = (? started Boolean, ? turn: Integer)
      @go = {
        g = Game(true, 5)
        -> result: 1
      }
    `)).not.toThrow();
  });

  it('allows omitting trailing optionals', () => {
    expect(() => compileSource(`
      ::Game = (? started Boolean, ? turn: Integer)
      @go = {
        g = Game(true)
        -> result: 1
      }
    `)).not.toThrow();
  });

  it('allows zero args when all fields are optional', () => {
    expect(() => compileSource(`
      ::Game = (? started Boolean, ? turn: Integer)
      @go = {
        g = Game()
        -> result: 1
      }
    `)).not.toThrow();
  });

  it('rejects too few args when required fields exist', () => {
    expect(() => compileSource(`
      ::User = (id Text, ? nickname: Text)
      @go = {
        u = User()
        -> result: 1
      }
    `)).toThrow();
  });
});

describe('shape optionality — operators', () => {
  it('?? returns the value when present', async () => {
    await expectBehavior(`
      ::Game = (? started Boolean, ? turn: Integer)
      @go = -> result: (Game(true, 5).turn ?? 0)
    `,
      { input: { id: '1', op: '@go', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' } },
    );
  });

  it('?? falls back when the field was omitted', async () => {
    await expectBehavior(`
      ::Game = (? started Boolean, ? turn: Integer)
      @go = -> result: (Game(true).turn ?? 99)
    `,
      { input: { id: '1', op: '@go', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 99 }, to: 'c' } },
    );
  });

  it('(expr)? is true when present', async () => {
    await expectBehavior(`
      ::Game = (? started Boolean, ? turn: Integer)
      @go = -> result: (Game(true, 5).turn)?
    `,
      { input: { id: '1', op: '@go', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Boolean' }, re: { result: true }, to: 'c' } },
    );
  });

  it('(expr)? is false when absent', async () => {
    await expectBehavior(`
      ::Game = (? started Boolean, ? turn: Integer)
      @go = -> result: (Game(true).turn)?
    `,
      { input: { id: '1', op: '@go', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Boolean' }, re: { result: false }, to: 'c' } },
    );
  });
});
