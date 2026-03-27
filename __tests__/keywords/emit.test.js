import compile from '../../index.js';
import { expectReply } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// emit — compilation
// ═══════════════════════════════════════════════════════════════════════════════

describe('emit — compilation', () => {
  it('emit declaration compiles', () => {
    expect(() => compile(`
      Firer = <> {
        emit fire() -> .
        @fire = { fire() }
      }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('emit declaration with args compiles', () => {
    expect(() => compile(`
      Notifier = <> {
        emit notify(msg : Text) -> .
        @send = |:msg : Text| { notify(msg) }
      }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('emit declaration with return type compiles', () => {
    expect(() => compile(`
      Checker = <> {
        emit check(n : Integer) -> (valid : Boolean)
        @validate = |:n : Integer| { :valid = check(n); -> :valid }
      }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('on handler compiles', () => {
    expect(() => compile(`
      Firer = <> {
        emit fire() -> .
        @fire = { fire() }
      }
      Counter = <firer> {
        ref count : Integer = 0
        on firer.fire { count <- count + 1 . }
        @count = -> :count : Integer
      }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// emit — silent (fire-and-forget)
// ═══════════════════════════════════════════════════════════════════════════════

describe('emit — silent fire-and-forget', () => {
  it('emit with no subscriber does not crash', async () => {
    await expectReply({
      script: `
        Firer = <> {
          emit fire() -> .
          @fire = { fire() }
          @ping = -> pong: "ok" as Text
        }
        @test
          =
          f = Firer()
          f.fire()
          :pong = f.ping()
          -> :pong : Text
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', 'bv-a': { pong: 'Text' }, re: { pong: 'ok' }, to: 'c' },
    });
  });

  it('emit with subscriber triggers handler', async () => {
    await expectReply({
      script: `
        Firer = <> {
          emit fire() -> .
          @fire = { fire() }
        }

        Counter = <firer> {
          ref count : Integer = 0
          on firer.fire { count <- count + 1 . }
          @count = -> :count : Integer
        }

        @test
          =
          f = Firer()
          c = Counter(f)
          f.fire()
          :count = c.count()
          -> :count : Integer
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', 'bv-a': { count: 'Integer' }, re: { count: 1 }, to: 'c' },
    });
  });

  it('multiple fires accumulate', async () => {
    await expectReply({
      script: `
        Firer = <> {
          emit fire() -> .
          @fire = { fire() }
        }

        Counter = <firer> {
          ref count : Integer = 0
          on firer.fire { count <- count + 1 . }
          @count = -> :count : Integer
        }

        @test
          =
          f = Firer()
          c = Counter(f)
          f.fire()
          f.fire()
          f.fire()
          :count = c.count()
          -> :count : Integer
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', 'bv-a': { count: 'Integer' }, re: { count: 3 }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// emit — with args
// ═══════════════════════════════════════════════════════════════════════════════

describe('emit — with args', () => {
  it('emit passes args to subscriber', async () => {
    await expectReply({
      script: `
        Firer = <> {
          emit fire(n : Integer) -> .
          @fire = |:n : Integer| { fire(n) }
        }

        Accumulator = <firer> {
          ref total : Integer = 0
          on firer.fire |:n : Integer| { total <- total + n . }
          @total = -> :total : Integer
        }

        @test
          =
          f = Firer()
          a = Accumulator(f)
          f.fire(n: 10)
          f.fire(n: 20)
          :total = a.total()
          -> :total : Integer
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', 'bv-a': { total: 'Integer' }, re: { total: 30 }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// emit — multiple subscribers
// ═══════════════════════════════════════════════════════════════════════════════

describe('emit — multiple subscribers', () => {
  it('two subscribers both receive the emit', async () => {
    await expectReply({
      script: `
        Firer = <> {
          emit fire() -> .
          @fire = { fire() }
        }

        CounterA = <firer> {
          ref count : Integer = 0
          on firer.fire { count <- count + 1 . }
          @count = -> :count : Integer
        }

        CounterB = <firer> {
          ref count : Integer = 100
          on firer.fire { count <- count + 1 . }
          @count = -> :count : Integer
        }

        @test
          =
          f = Firer()
          a = CounterA(f)
          b = CounterB(f)
          f.fire()
          :countA = a.count()
          :countB = b.count()
          -> :countA, :countB
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', re: { countA: 1, countB: 101 }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// emit — with return value
// ═══════════════════════════════════════════════════════════════════════════════

describe('emit — with return value', () => {
  it('emit waits for subscriber response', async () => {
    await expectReply({
      script: `
        Checker = <> {
          emit check(n : Integer) -> (valid : Boolean)
          @validate = |:n : Integer| {
            :valid = check(n)
            -> :valid
          }
        }

        Rules = <checker> {
          on checker.check |:n : Integer| -> valid: (n > 0) as Boolean
        }

        @test
          =
          c = Checker()
          r = Rules(c)
          :valid = c.validate(n: 5)
          -> :valid
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', 'bv-a': { valid: 'Boolean' }, re: { valid: true }, to: 'c' },
    });
  });
});
