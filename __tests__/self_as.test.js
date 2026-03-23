import compile from '../index.js';
import { expectActorReply } from './helpers.js';

describe('self-as clauses', () => {
  const script = `
    One
      =
      self as Integer = -> 1
      self as Text = -> "one"
      self as Boolean = -> true
      @ping = -> pong: "ok" as Text
      -> self
    end#One

    Multi
      =
      self as Integer = -> 42
      self as Text = -> "forty-two"
      self as Boolean = -> false
      @ping = -> pong: "ok" as Text
      -> self
    end#Multi

    Greeter
      =
      self as Integer = -> 99
      @hello = -> answer: "world" as Text
      -> self
    end#Greeter

    Wrapper
      =
      self as !Wrapper = -> 0
      @ping = -> pong: "ok" as Text
      -> self
    end#Wrapper

    WrapperText
      =
      self as !WrapperText = -> "default"
      @ping = -> pong: "ok" as Text
      -> self
    end#WrapperText

    OneTwoLine
      =
      self as Integer
        =
        -> 1
      @ping = -> pong: "ok" as Text
      -> self
    end#OneTwoLine

    Dual
      =
      self as Integer = -> 7
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

  it('self as Integer — literal cast', async () => {
    await expectActorReply({ script, receive: { id: '1', op: '@asInt', from: 'c' }, reply: { id: '1', 'bv-a': ['Integer'], re: [1], to: 'c' } });
  });

  it('self as Text — literal cast', async () => {
    await expectActorReply({ script, receive: { id: '2', op: '@asText', from: 'c' }, reply: { id: '2', 'bv-a': ['Text'], re: ['one'], to: 'c' } });
  });

  it('self as Boolean — literal cast', async () => {
    await expectActorReply({ script, receive: { id: '3', op: '@asBool', from: 'c' }, reply: { id: '3', 'bv-a': ['Boolean'], re: [true], to: 'c' } });
  });

  it('multiple self-as clauses — correct one selected by target type', async () => {
    await expectActorReply({
      script, receive: { id: '4', op: '@multiCast', from: 'c' },
      reply: { id: '4', 'bv-a': { n: 'Integer', t: 'Text', b: 'Boolean' }, re: { n: 42, t: 'forty-two', b: false }, to: 'c' },
    });
  });

  it('untyped assignment — no cast, still works via ref', async () => {
    await expectActorReply({ script, receive: { id: '5', op: '@untypedRef', from: 'c' }, reply: { id: '5', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' } });
  });

  it('negated catch-all — as !Self (Integer target)', async () => {
    await expectActorReply({ script, receive: { id: '6', op: '@negatedInt', from: 'c' }, reply: { id: '6', 'bv-a': ['Integer'], re: [0], to: 'c' } });
  });

  it('negated catch-all — as !Self (Text target)', async () => {
    await expectActorReply({ script, receive: { id: '7', op: '@negatedText', from: 'c' }, reply: { id: '7', 'bv-a': ['Text'], re: ['default'], to: 'c' } });
  });

  it('self-as clause — two-line form', async () => {
    await expectActorReply({ script, receive: { id: '8', op: '@twoLineForm', from: 'c' }, reply: { id: '8', 'bv-a': ['Integer'], re: [1], to: 'c' } });
  });

  it('actor with both as clauses and public functions coexist', async () => {
    await expectActorReply({
      script, receive: { id: '9', op: '@dualCoexist', from: 'c' },
      reply: { id: '9', 'bv-a': { n: 'Integer', msg: 'Text' }, re: { n: 7, msg: 'hi' }, to: 'c' },
    });
  });
});

describe('self as — compile errors', () => {
  it('no matching self-as clause → compile-time error', () => {
    expect(() => compile(`
      One
        =
        self as Integer = -> 1
        self as Text = -> "one"
        @ping = -> pong: "ok" as Text
        -> self
      end#One

      @test
        =
        d : Decimal = One()
        -> d : Decimal
    `)).toThrow(/No matching 'self-as' clause in actor 'One' for type 'Decimal'/);
  });
});
