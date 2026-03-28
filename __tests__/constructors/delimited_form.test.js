import compile from '../../index.js';
import { expectReply } from '../helpers.js';

describe('constructor delimited form — compilation', () => {
  it('no-param constructor with braced body', () => {
    expect(() => compile(`
      Greeter = <> {
        @hello = -> greeting: "hi" as Text
      }
      @test
        =
        g = Greeter()
        :greeting = g.hello()
        -> :greeting as Text
    `)).not.toThrow();
  });

  it('constructor with params and braced body', () => {
    expect(() => compile(`
      Counter = <start Integer> {
        ref count Integer = start
        @get = -> value: count as Integer
      }
      @test
        =
        c = Counter(0)
        :value = c.get()
        -> :value as Integer
    `)).not.toThrow();
  });

  it('constructor with multiple params', () => {
    expect(() => compile(`
      Pair = <a Integer, b Integer> {
        @sum = -> total: (a + b) as Integer
      }
      @test
        =
        p = Pair(3, 4)
        :total = p.sum()
        -> :total as Integer
    `)).not.toThrow();
  });
});

describe('constructor delimited form — runtime', () => {
  it('no-param constructor works', async () => {
    await expectReply({
      script: `
        Greeter = <> {
          @hello = -> greeting: "hi" as Text
        }
        @test
          =
          g = Greeter()
          :greeting = g.hello()
          -> :greeting as Text
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', 'bv-a': { greeting: 'Text' }, re: { greeting: 'hi' }, to: 'c' },
    });
  });

  it('constructor with param works', async () => {
    await expectReply({
      script: `
        Counter = <start Integer> {
          ref count Integer = start
          @get = -> value: count as Integer
        }
        @test
          =
          c = Counter(10)
          :value = c.get()
          -> :value as Integer
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', 'bv-a': { value: 'Integer' }, re: { value: 10 }, to: 'c' },
    });
  });

  it('multiple params work', async () => {
    await expectReply({
      script: `
        Pair = <a Integer, b Integer> {
          @sum = -> total: (a + b) as Integer
        }
        @test
          =
          p = Pair(3, 4)
          :total = p.sum()
          -> :total as Integer
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', 'bv-a': { total: 'Integer' }, re: { total: 7 }, to: 'c' },
    });
  });
});
