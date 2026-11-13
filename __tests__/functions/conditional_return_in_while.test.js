import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Conditional return inside `repeat while` — public handler bodies
// ═══════════════════════════════════════════════════════════════════════════════

describe('conditional return inside repeat while — public handler', () => {
  const script = `
    @blockGuard
      =
      x *Integer = 0
      repeat while x < 100 {
        x <- x + 1
        if (x > 5) { return "early" }
      }
      return "fallthrough"

    @noTrigger
      =
      x *Integer = 0
      repeat while x < 3 {
        x <- x + 1
        if (x > 100) { return "never" }
      }
      return "after-loop"

    @singleLineGuard
      =
      x *Integer = 0
      repeat while x < 100 {
        x <- x + 1
        if (x > 4) -> "early-sl"
      }
      return "fallthrough"

    @ifElseInWhile
      =
      x *Integer = 0
      repeat while x < 100 {
        x <- x + 1
        if (x > 0) { return "got it" }
        else { return "impossible" }
      }
      return "unreachable"
  `;

  it('block-body guard short-circuits enclosing handler', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'blockGuard', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: ['early'], to: 'c' }) });
  });

  it('guard never triggers — falls through to post-loop reply', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'noTrigger', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: ['after-loop'], to: 'c' }) });
  });

  it('single-line guard inside while — short-circuits', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: 'singleLineGuard', from: 'c' } },
      { output: expect.objectContaining({ id: '3', re: ['early-sl'], to: 'c' }) });
  });

  it('if/else inside while — if branch fires on first iteration', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: 'ifElseInWhile', from: 'c' } },
      { output: expect.objectContaining({ id: '4', re: ['got it'], to: 'c' }) });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Conditional return inside `repeat until`
// ═══════════════════════════════════════════════════════════════════════════════

describe('conditional return inside repeat until — public handler', () => {
  const script = `
    @blockGuard
      =
      x *Integer = 0
      repeat until x >= 100 {
        x <- x + 1
        if (x > 7) { return "early" }
      }
      return "fallthrough"

    @noTrigger
      =
      x *Integer = 0
      repeat until x >= 3 {
        x <- x + 1
        if (x > 100) { return "never" }
      }
      return "after-loop"

    @singleLine
      =
      x *Integer = 0
      repeat until x >= 100 {
        x <- x + 1
        if (x > 6) -> "sl-early"
      }
      return "fallthrough"
  `;

  it('block-body guard inside repeat until short-circuits', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'blockGuard', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: ['early'], to: 'c' }) });
  });

  it('guard never triggers — falls through after loop', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'noTrigger', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: ['after-loop'], to: 'c' }) });
  });

  it('single-line guard inside repeat until — short-circuits', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: 'singleLine', from: 'c' } },
      { output: expect.objectContaining({ id: '3', re: ['sl-early'], to: 'c' }) });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Conditional return inside `repeat while` — lambda functions
// ═══════════════════════════════════════════════════════════════════════════════

describe('conditional return inside repeat while — lambda', () => {
  const script = `
    @check
      =
      fn = (limit Integer) {
        x *Integer = 0
        repeat while x < limit {
          x <- x + 1
          if (x > 3) { return "found" }
        }
        return "none"
      }
      hit Text = fn(10)
      miss Text = fn(2)
      return :hit, :miss

    @checkSingleLine
      =
      fn = (limit Integer) {
        x *Integer = 0
        repeat while x < limit {
          x <- x + 1
          if (x > 3) -> "found"
        }
        return "none"
      }
      hit Text = fn(10)
      miss Text = fn(2)
      return :hit, :miss
  `;

  it('block-body guard inside lambda + while', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'check', from: 'c' } },
      { output: { id: '1', 'ty': { hit: 'Text', miss: 'Text' }, re: { hit: 'found', miss: 'none' }, to: 'c' } });
  });

  it('single-line guard inside lambda + while', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'checkSingleLine', from: 'c' } },
      { output: { id: '2', 'ty': { hit: 'Text', miss: 'Text' }, re: { hit: 'found', miss: 'none' }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Conditional return inside `repeat while` — lineal private functions
// ═══════════════════════════════════════════════════════════════════════════════

describe('conditional return inside repeat while — lineal', () => {
  const script = `
    @hitTest
      =
      result Text = scan(10)
      return :result

    @missTest
      =
      result Text = scan(2)
      return :result

    @untilHit
      =
      result Text = scanUntil(10)
      return :result

    @untilMiss
      =
      result Text = scanUntil(2)
      return :result

    scan
      =
      limit Integer
      =
      x *Integer = 0
      repeat while x < limit {
        x <- x + 1
        if (x > 3) { return "found" }
      }
      return "none"

    scanUntil
      =
      limit Integer
      =
      x *Integer = 0
      repeat until x >= limit {
        x <- x + 1
        if (x > 4) { return "found" }
      }
      return "none"
  `;

  it('lineal — repeat while guard fires', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'hitTest', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Text' }, re: { result: 'found' }, to: 'c' } });
  });

  it('lineal — repeat while guard never fires, falls through', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'missTest', from: 'c' } },
      { output: { id: '2', 'ty': { result: 'Text' }, re: { result: 'none' }, to: 'c' } });
  });

  it('lineal — repeat until guard fires', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: 'untilHit', from: 'c' } },
      { output: { id: '3', 'ty': { result: 'Text' }, re: { result: 'found' }, to: 'c' } });
  });

  it('lineal — repeat until guard never fires, falls through', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: 'untilMiss', from: 'c' } },
      { output: { id: '4', 'ty': { result: 'Text' }, re: { result: 'none' }, to: 'c' } });
  });
});
