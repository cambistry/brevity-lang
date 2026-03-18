import compile from '../index.js';
import { expectReply } from './helpers.js';

describe('Type | null — valid syntax', () => {
  it('Integer | null is a valid type (no throw)', () => {
    expect(() => compile(`
      @test
        =
        x : Integer | null = null
        -> result: 0 : Integer
    `)).not.toThrow();
  });

  it('Text | null is a valid type (no throw)', () => {
    expect(() => compile(`
      @test
        =
        x : Text | null = null
        -> result: 0 : Integer
    `)).not.toThrow();
  });

  it('Float | null is a valid type (no throw)', () => {
    expect(() => compile(`
      @test
        =
        x : Float | null = null
        -> result: 0 : Integer
    `)).not.toThrow();
  });

  it('Boolean | null is a valid type (no throw)', () => {
    expect(() => compile(`
      @test
        =
        x : Boolean | null = null
        -> result: 0 : Integer
    `)).not.toThrow();
  });

  it('List of Integers | null is a valid type (no throw)', () => {
    expect(() => compile(`
      @test
        =
        x : List of Integers | null = null
        -> result: 0 : Integer
    `)).not.toThrow();
  });

  it('List of Texts | null is a valid type (no throw)', () => {
    expect(() => compile(`
      @test
        =
        x : List of Texts | null = null
        -> result: 0 : Integer
    `)).not.toThrow();
  });
});

describe('Type | null — plural standalone still errors', () => {
  it('Integers | null throws', () => {
    expect(() => compile(`
      @test
        =
        x : Integers | null = null
        -> result: 0 : Integer
    `)).toThrow(/'Integers' is not a valid standalone type/);
  });

  it('Texts | null throws', () => {
    expect(() => compile(`
      @test
        =
        x : Texts | null = null
        -> result: 0 : Integer
    `)).toThrow(/'Texts' is not a valid standalone type/);
  });
});

describe('Type | null — runtime behaviour', () => {
  it('Text | null var holding a Text value replies correctly', async () => {
    const source = `
      @test
        =
        msg : Text | null = "hello" : Text
        -> result: msg
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Text | null' },
        re: { result: 'hello' },
        to: 'caller',
      },
    });
  });

  it('Float | null var holding null replies correctly', async () => {
    const source = `
      @test
        =
        x : Float | null = null
        -> result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Float | null' },
        re: { result: null },
        to: 'caller',
      },
    });
  });
});
