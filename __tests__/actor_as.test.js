import { expectReply } from './helpers.js';
import compile from '../index.js';

describe('actor as clauses', () => {
  it('as Integer — literal cast', async () => {
    const source = `
      actor One
        as Integer -> 1
        @ping() -> pong: "ok" : Text
      end#One

      @test()
        w : Integer = One()
        -> w : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': ['Integer'], re: [1], to: 'caller' },
    });
  });

  it('as Text — literal cast', async () => {
    const source = `
      actor One
        as Text -> "one"
        @ping() -> pong: "ok" : Text
      end#One

      @test()
        t : Text = One()
        -> t : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': ['Text'], re: ['one'], to: 'caller' },
    });
  });

  it('as Boolean — literal cast', async () => {
    const source = `
      actor One
        as Boolean -> true
        @ping() -> pong: "ok" : Text
      end#One

      @test()
        b : Boolean = One()
        -> b : Boolean
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': ['Boolean'], re: [true], to: 'caller' },
    });
  });

  it('multiple as clauses — correct one selected by target type', async () => {
    const source = `
      actor Multi
        as Integer -> 42
        as Text -> "forty-two"
        as Boolean -> false
        @ng() -> pong: "ok" : Text
      end#Multi

      @test()
        n : Integer = Multi()
        t : Text = Multi()
        b : Boolean = Multi()
        -> n: n : Integer, t: t : Text, b: b : Boolean
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { n: 'Integer', t: 'Text', b: 'Boolean' },
        re: { n: 42, t: 'forty-two', b: false },
        to: 'caller',
      },
    });
  });

  it('untyped assignment — no cast, actor still works via ref', async () => {
    const source = `
      actor Greeter
        as Integer -> 99
        @hello() -> answer: "world" : Text
      end#Greeter

      @test()
        ref g = Greeter()
        :answer = g.hello()
        -> :answer : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { answer: 'Text' },
        re: { answer: 'world' },
        to: 'caller',
      },
    });
  });

  it('no matching as clause — compile-time error', () => {
    const source = `
      actor One
        as Integer -> 1
        as Text -> "one"
        @ping() -> pong: "ok" : Text
      end#One

      @test()
        d : Decimal = One()
        -> d : Decimal
    `;
    expect(() => compile(source)).toThrow(/No matching 'as' clause in actor 'One' for type 'Decimal'/);
  });

  it('negated catch-all — as !Self', async () => {
    const source = `
      actor Wrapper
        as !Wrapper -> 0
        @ping() -> pong: "ok" : Text
      end#Wrapper

      @test()
        n : Integer = Wrapper()
        -> n : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': ['Integer'], re: [0], to: 'caller' },
    });
  });

  it('negated catch-all — works with any target type', async () => {
    const source = `
      actor Wrapper
        as !Wrapper -> "default"
        @ping() -> pong: "ok" : Text
      end#Wrapper

      @test()
        t : Text = Wrapper()
        -> t : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': ['Text'], re: ['default'], to: 'caller' },
    });
  });

  it('as clause — two-line form', async () => {
    const source = `
      actor One
        as Integer
          -> 1
        @ping() -> pong: "ok" : Text
      end#One

      @test()
        w : Integer = One()
        -> w : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': ['Integer'], re: [1], to: 'caller' },
    });
  });

  it('actor with both as clauses and on handlers coexist', async () => {
    const source = `
      actor Dual
        as Integer -> 7
        @greet() -> msg: "hi" : Text
      end#Dual

      @test()
        n : Integer = Dual()
        ref d = Dual()
        :msg = d.greet()
        -> n: n : Integer, msg: msg : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { n: 'Integer', msg: 'Text' },
        re: { n: 7, msg: 'hi' },
        to: 'caller',
      },
    });
  });
});
