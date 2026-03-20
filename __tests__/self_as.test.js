import compile from '../index.js';
import { runActor } from './helpers.js';

describe('self as clauses', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      One
        =
        as Integer -> 1
        as Text -> "one"
        as Boolean -> true
        @ping = -> pong: "ok" as Text
        -> self
      end#One

      Multi
        =
        as Integer -> 42
        as Text -> "forty-two"
        as Boolean -> false
        @ping = -> pong: "ok" as Text
        -> self
      end#Multi

      Greeter
        =
        as Integer -> 99
        @hello = -> answer: "world" as Text
        -> self
      end#Greeter

      Wrapper
        =
        as !Wrapper -> 0
        @ping = -> pong: "ok" as Text
        -> self
      end#Wrapper

      WrapperText
        =
        as !WrapperText -> "default"
        @ping = -> pong: "ok" as Text
        -> self
      end#WrapperText

      OneTwoLine
        =
        as Integer
          -> 1
        @ping = -> pong: "ok" as Text
        -> self
      end#OneTwoLine

      Dual
        =
        as Integer -> 7
        @greet = -> msg: "hi" as Text
        -> self
      end#Dual

      @asInt
        =
        w : Integer = One()
        -> w : Integer

      @asText
        =
        t : Text = One()
        -> t : Text

      @asBool
        =
        b : Boolean = One()
        -> b : Boolean

      @multiCast
        =
        n : Integer = Multi()
        t : Text = Multi()
        b : Boolean = Multi()
        -> n: n : Integer, t: t : Text, b: b : Boolean

      @untypedRef
        =
        ref g = Greeter()
        :answer = g.hello()
        -> :answer : Text

      @negatedInt
        =
        n : Integer = Wrapper()
        -> n : Integer

      @negatedText
        =
        t : Text = WrapperText()
        -> t : Text

      @twoLineForm
        =
        w : Integer = OneTwoLine()
        -> w : Integer

      @dualCoexist
        =
        n : Integer = Dual()
        ref d = Dual()
        :msg = d.greet()
        -> n: n : Integer, msg: msg : Text
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'asInt', from: 'c' },
        { id: '2', op: 'asText', from: 'c' },
        { id: '3', op: 'asBool', from: 'c' },
        { id: '4', op: 'multiCast', from: 'c' },
        { id: '5', op: 'untypedRef', from: 'c' },
        { id: '6', op: 'negatedInt', from: 'c' },
        { id: '7', op: 'negatedText', from: 'c' },
        { id: '8', op: 'twoLineForm', from: 'c' },
        { id: '9', op: 'dualCoexist', from: 'c' },
      ],
    });
  });

  it('as Integer — literal cast', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': ['Integer'], re: [1], to: 'c' });
  });

  it('as Text — literal cast', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': ['Text'], re: ['one'], to: 'c' });
  });

  it('as Boolean — literal cast', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': ['Boolean'], re: [true], to: 'c' });
  });

  it('multiple as clauses — correct one selected by target type', () => {
    expect(outputs[3]).toEqual({
      id: '4', 'bv-a': { n: 'Integer', t: 'Text', b: 'Boolean' },
      re: { n: 42, t: 'forty-two', b: false }, to: 'c',
    });
  });

  it('untyped assignment — no cast, still works via ref', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' });
  });

  it('negated catch-all — as !Self (Integer target)', () => {
    expect(outputs[5]).toEqual({ id: '6', 'bv-a': ['Integer'], re: [0], to: 'c' });
  });

  it('negated catch-all — as !Self (Text target)', () => {
    expect(outputs[6]).toEqual({ id: '7', 'bv-a': ['Text'], re: ['default'], to: 'c' });
  });

  it('as clause — two-line form', () => {
    expect(outputs[7]).toEqual({ id: '8', 'bv-a': ['Integer'], re: [1], to: 'c' });
  });

  it('actor with both as clauses and public functions coexist', () => {
    expect(outputs[8]).toEqual({
      id: '9', 'bv-a': { n: 'Integer', msg: 'Text' }, re: { n: 7, msg: 'hi' }, to: 'c',
    });
  });
});

describe('self as — compile errors', () => {
  it('no matching as clause → compile-time error', () => {
    expect(() => compile(`
      One
        =
        as Integer -> 1
        as Text -> "one"
        @ping = -> pong: "ok" as Text
        -> self
      end#One

      @test
        =
        d : Decimal = One()
        -> d : Decimal
    `)).toThrow(/No matching 'as' clause in actor 'One' for type 'Decimal'/);
  });
});
