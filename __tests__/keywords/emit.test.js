import { expectBehavior, compileSource } from '../helpers.js';

// ─── shared fixtures ─────────────────────────────────────────────────────────

const silentEmitScript = `
  Firer = * {
    emit fire() -> .
    @fire = { fire() }
    @ping = -> pong: "ok"
  }

  Counter = *(firer *) {
    count Integer! = 0
    on firer.fire { count <- count + 1 . }
    @count = -> :count
  }

  @noSub
    =
    f = Firer()
    f.fire()
    :pong Text = f.ping()
    -> :pong

  @oneSub
    =
    f = Firer()
    c = Counter(f)
    f.fire()
    :count Integer = c.count()
    -> :count

  @threeFires
    =
    f = Firer()
    c = Counter(f)
    f.fire()
    f.fire()
    f.fire()
    :count Integer = c.count()
    -> :count

`;

const argsEmitScript = `
  Firer = * {
    emit fire(n Integer) -> .
    @fire = (:n Integer) { fire(n) }
  }

  Accumulator = *(firer *) {
    total Integer! = 0
    on firer.fire (:n Integer) { total <- total + n . }
    @total = -> :total
  }

  @test
    =
    f = Firer()
    a = Accumulator(f)
    f.fire(n: 10)
    f.fire(n: 20)
    :total Integer = a.total()
    -> :total
`;

const returnEmitScript = `
  Checker = * {
    emit check(n Integer) -> (valid Boolean)
    @validate = (:n Integer) {
      :valid = check(n)
      -> :valid
    }
  }

  Rules = *(checker *) {
    on checker.check (:n Integer) -> valid: (n > 0)
  }

  @test
    =
    c = Checker()
    r = Rules(c)
    :valid = c.validate(n: 5)
    -> :valid
`;

// ═══════════════════════════════════════════════════════════════════════════════
// emit — compilation
// ═══════════════════════════════════════════════════════════════════════════════

describe('emit — compilation', () => {
  it('emit declaration compiles', () => {
    expect(() => compileSource(`
      Firer = * {
        emit fire() -> .
        @fire = { fire() }
      }
      @test = -> 1
    `)).not.toThrow();
  });

  it('emit declaration with args compiles', () => {
    expect(() => compileSource(`
      Notifier = * {
        emit notify(msg Text) -> .
        @send = (:msg Text) { notify(msg) }
      }
      @test = -> 1
    `)).not.toThrow();
  });

  it('emit declaration with return type compiles', () => {
    expect(() => compileSource(`
      Checker = * {
        emit check(n Integer) -> (valid Boolean)
        @validate = (:n Integer) { :valid = check(n); -> :valid }
      }
      @test = -> 1
    `)).not.toThrow();
  });

  it('on handler compiles', () => {
    expect(() => compileSource(`
      Firer = * {
        emit fire() -> .
        @fire = { fire() }
      }
      Counter = *(firer *) {
        count Integer! = 0
        on firer.fire { count <- count + 1 . }
        @count = -> :count
      }
      @test = -> 1
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// emit — silent (fire-and-forget)
// ═══════════════════════════════════════════════════════════════════════════════

describe('emit — silent fire-and-forget', () => {
  it('emit with no subscriber does not crash', async () => {
    await expectBehavior(silentEmitScript,
      { input: { id: '1', op: '@noSub', from: 'c' } },
      { output: { id: '1', 'bv-a': { pong: 'Text' }, re: { pong: 'ok' }, to: 'c' } },
    );
  });

  it('emit with subscriber triggers handler', async () => {
    await expectBehavior(silentEmitScript,
      { input: { id: '1', op: '@oneSub', from: 'c' } },
      { output: { id: '1', 'bv-a': { count: 'Integer' }, re: { count: 1 }, to: 'c' } },
    );
  });

  it('multiple fires accumulate', async () => {
    await expectBehavior(silentEmitScript,
      { input: { id: '1', op: '@threeFires', from: 'c' } },
      { output: { id: '1', 'bv-a': { count: 'Integer' }, re: { count: 3 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// emit — with args
// ═══════════════════════════════════════════════════════════════════════════════

describe('emit — with args', () => {
  it('emit passes args to subscriber', async () => {
    await expectBehavior(argsEmitScript,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { total: 'Integer' }, re: { total: 30 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// emit — multiple subscribers
// ═══════════════════════════════════════════════════════════════════════════════

describe('emit — multiple subscribers', () => {
  it('two subscribers both receive the emit', async () => {
    const script = `
      Firer = * {
        emit fire() -> .
        @fire = { fire() }
      }

      CounterA = *(firer *) {
        count Integer! = 0
        on firer.fire { count <- count + 1 . }
        @count = -> :count
      }

      CounterB = *(firer *) {
        count Integer! = 100
        on firer.fire { count <- count + 1 . }
        @count = -> :count
      }

      @test
        =
        f = Firer()
        a = CounterA(f)
        b = CounterB(f)
        f.fire()
        :count Integer = a.count()
        -> :count
    `;
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { count: 'Integer' }, re: { count: 1 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// emit — with return value
// ═══════════════════════════════════════════════════════════════════════════════

describe('emit — with return value', () => {
  it('emit waits for subscriber response', async () => {
    await expectBehavior(returnEmitScript,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', re: { valid: true }, to: 'c' } },
    );
  });
});
