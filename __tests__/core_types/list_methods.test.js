import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// List methods — pure (List.fn / *list.method) and bang (*list.method!).
//
// Equality semantics for contains/index_of/replace/before/after/starts_with/
// ends_with route through _bv_eq: structural for primitives, value-equal for
// Decimal, recursive for nested lists, identity for actor refs.
//
// Out-of-range indices clamp silently to match slice/take/from on Text/Blob.
// ═══════════════════════════════════════════════════════════════════════════════

const out = (id, type, value) => ({ output: { id, 'bv-a': { result: type }, re: { result: value }, to: 'c' } });
const inp = (id, op) => ({ input: { id, op, from: 'c' } });

// ─── Tier 1: meta + index access ──────────────────────────────────────────────

describe('List.size / List.empty?', () => {
  const script = `
      @sizeFunc  = -> result: List.size([1, 2, 3])
      @sizeRef   = { ns List of Integers! = [1,2,3]; -> result: ns.size }
      @sizeEmpty = { empty List of Integers = []; -> result: List.size(empty) }
      @emptyTrue = { empty List of Integers = []; -> result: List.empty?(empty) }
      @emptyFalse = -> result: List.empty?([1])
  `;
  it('List.size literal', async () => {
    await expectBehavior(script, inp('1', '@sizeFunc'), out('1', 'Integer', 3));
  });
  it('ref.size', async () => {
    await expectBehavior(script, inp('2', '@sizeRef'), out('2', 'Integer', 3));
  });
  it('size of empty', async () => {
    await expectBehavior(script, inp('3', '@sizeEmpty'), out('3', 'Integer', 0));
  });
  it('empty? true', async () => {
    await expectBehavior(script, inp('4', '@emptyTrue'), out('4', 'Boolean', true));
  });
  it('empty? false', async () => {
    await expectBehavior(script, inp('5', '@emptyFalse'), out('5', 'Boolean', false));
  });
});

describe('List.first / List.last / List.at', () => {
  const script = `
      @firstFunc = -> result: List.first([10, 20, 30])
      @lastFunc  = -> result: List.last([10, 20, 30])
      @atFunc    = -> result: List.at([10, 20, 30], 1)
      @atOver    = -> result: List.at([10, 20, 30], 99)
      @firstRef  = { ns List of Integers! = [42]; -> result: ns.first }
  `;
  it('first', async () => {
    await expectBehavior(script, inp('1', '@firstFunc'), out('1', 'Integer', 10));
  });
  it('last', async () => {
    await expectBehavior(script, inp('2', '@lastFunc'), out('2', 'Integer', 30));
  });
  it('at(1)', async () => {
    await expectBehavior(script, inp('3', '@atFunc'), out('3', 'Integer', 20));
  });
  it('at out-of-range → null', async () => {
    await expectBehavior(script, inp('4', '@atOver'), out('4', 'Integer', null));
  });
  it('ref.first', async () => {
    await expectBehavior(script, inp('5', '@firstRef'), out('5', 'Integer', 42));
  });
});

// ─── Tier 1: index slicing ────────────────────────────────────────────────────

describe('List.slice / List.take / List.from', () => {
  const script = `
      @sliceMid  = -> result: List.slice([1,2,3,4,5], 1, 4)
      @sliceEnd  = -> result: List.slice([1,2,3,4,5], 2)
      @takeFirst = -> result: List.take([1,2,3,4,5], 3)
      @takeOver  = -> result: List.take([1,2], 99)
      @takeZero  = -> result: List.take([1,2,3], 0)
      @fromMid   = -> result: List.from([1,2,3,4,5], 2)
      @fromOver  = -> result: List.from([1,2], 99)
      @fromZero  = -> result: List.from([1,2,3], 0)
      @sliceBang = { ns List of Integers! = [1,2,3,4,5]; ns.slice!(1, 4); -> result: ns }
      @takeBang  = { ns List of Integers! = [1,2,3,4,5]; ns.take!(2); -> result: ns }
      @fromBang  = { ns List of Integers! = [1,2,3,4,5]; ns.from!(3); -> result: ns }
  `;
  it('slice(1, 4)', async () => {
    await expectBehavior(script, inp('1', '@sliceMid'), out('1', 'List of Integers', [2, 3, 4]));
  });
  it('slice(2) — open end', async () => {
    await expectBehavior(script, inp('2', '@sliceEnd'), out('2', 'List of Integers', [3, 4, 5]));
  });
  it('take(3)', async () => {
    await expectBehavior(script, inp('3', '@takeFirst'), out('3', 'List of Integers', [1, 2, 3]));
  });
  it('take(99) clamps', async () => {
    await expectBehavior(script, inp('4', '@takeOver'), out('4', 'List of Integers', [1, 2]));
  });
  it('take(0) → empty', async () => {
    await expectBehavior(script, inp('5', '@takeZero'), out('5', 'List of Integers', []));
  });
  it('from(2)', async () => {
    await expectBehavior(script, inp('6', '@fromMid'), out('6', 'List of Integers', [3, 4, 5]));
  });
  it('from(99) → empty', async () => {
    await expectBehavior(script, inp('7', '@fromOver'), out('7', 'List of Integers', []));
  });
  it('from(0) — whole list', async () => {
    await expectBehavior(script, inp('8', '@fromZero'), out('8', 'List of Integers', [1, 2, 3]));
  });
  it('slice! mutates ref', async () => {
    await expectBehavior(script, inp('9', '@sliceBang'), out('9', 'List of Integers', [2, 3, 4]));
  });
  it('take! mutates ref', async () => {
    await expectBehavior(script, inp('10', '@takeBang'), out('10', 'List of Integers', [1, 2]));
  });
  it('from! mutates ref', async () => {
    await expectBehavior(script, inp('11', '@fromBang'), out('11', 'List of Integers', [4, 5]));
  });
});

// ─── Tier 1: predicates and search (uses _bv_eq) ──────────────────────────────

describe('List.contains / List.index_of', () => {
  const script = `
      @contTrue  = -> result: List.contains([1,2,3], 2)
      @contFalse = -> result: List.contains([1,2,3], 99)
      @indexHit  = -> result: List.index_of([10,20,30], 30)
      @indexMiss = -> result: List.index_of([10,20,30], 99)
      @containsRef = { ns List of Integers! = [1,2,3]; -> result: ns.contains(2) }
  `;
  it('contains hit', async () => {
    await expectBehavior(script, inp('1', '@contTrue'), out('1', 'Boolean', true));
  });
  it('contains miss', async () => {
    await expectBehavior(script, inp('2', '@contFalse'), out('2', 'Boolean', false));
  });
  it('index_of hit', async () => {
    await expectBehavior(script, inp('3', '@indexHit'), out('3', 'Integer', 2));
  });
  it('index_of miss → -1', async () => {
    await expectBehavior(script, inp('4', '@indexMiss'), out('4', 'Integer', -1));
  });
  it('ref.contains', async () => {
    await expectBehavior(script, inp('5', '@containsRef'), out('5', 'Boolean', true));
  });
});

describe('List.starts_with / List.ends_with', () => {
  const script = `
      @swYes = -> result: List.starts_with([1,2,3,4], [1,2])
      @swNo  = -> result: List.starts_with([1,2,3,4], [2,3])
      @ewYes = -> result: List.ends_with([1,2,3,4], [3,4])
      @ewNo  = -> result: List.ends_with([1,2,3,4], [3,5])
      @swEmpty = { empty List of Integers = []; -> result: List.starts_with([1,2], empty) }
  `;
  it('starts_with hit', async () => {
    await expectBehavior(script, inp('1', '@swYes'), out('1', 'Boolean', true));
  });
  it('starts_with miss', async () => {
    await expectBehavior(script, inp('2', '@swNo'), out('2', 'Boolean', false));
  });
  it('ends_with hit', async () => {
    await expectBehavior(script, inp('3', '@ewYes'), out('3', 'Boolean', true));
  });
  it('ends_with miss', async () => {
    await expectBehavior(script, inp('4', '@ewNo'), out('4', 'Boolean', false));
  });
  it('starts_with empty prefix', async () => {
    await expectBehavior(script, inp('5', '@swEmpty'), out('5', 'Boolean', true));
  });
});

describe('List.before / List.after', () => {
  const script = `
      @beforeHit = -> result: List.before([1,2,3,4,5], 3)
      @afterHit  = -> result: List.after([1,2,3,4,5], 3)
      @beforeMiss = -> result: List.before([1,2,3], 99)
      @afterMiss  = -> result: List.after([1,2,3], 99)
  `;
  it('before(3) → [1,2]', async () => {
    await expectBehavior(script, inp('1', '@beforeHit'), out('1', 'List of Integers', [1, 2]));
  });
  it('after(3) → [4,5]', async () => {
    await expectBehavior(script, inp('2', '@afterHit'), out('2', 'List of Integers', [4, 5]));
  });
  it('before miss → whole list', async () => {
    await expectBehavior(script, inp('3', '@beforeMiss'), out('3', 'List of Integers', [1, 2, 3]));
  });
  it('after miss → empty', async () => {
    await expectBehavior(script, inp('4', '@afterMiss'), out('4', 'List of Integers', []));
  });
});

// ─── Tier 1: transforms ───────────────────────────────────────────────────────

describe('List.reverse / List.repeat', () => {
  const script = `
      @rev      = -> result: List.reverse([1,2,3])
      @repeat3  = -> result: List.repeat([1,2], 3)
      @repeat0  = -> result: List.repeat([1,2], 0)
      @revBang  = { ns List of Integers! = [1,2,3]; ns.reverse!; -> result: ns }
      @repeatBang = { ns List of Integers! = [1,2]; ns.repeat!(2); -> result: ns }
  `;
  it('reverse', async () => {
    await expectBehavior(script, inp('1', '@rev'), out('1', 'List of Integers', [3, 2, 1]));
  });
  it('repeat 3 times', async () => {
    await expectBehavior(script, inp('2', '@repeat3'), out('2', 'List of Integers', [1, 2, 1, 2, 1, 2]));
  });
  it('repeat 0 → empty', async () => {
    await expectBehavior(script, inp('3', '@repeat0'), out('3', 'List of Integers', []));
  });
  it('reverse! mutates', async () => {
    await expectBehavior(script, inp('4', '@revBang'), out('4', 'List of Integers', [3, 2, 1]));
  });
  it('repeat! mutates', async () => {
    await expectBehavior(script, inp('5', '@repeatBang'), out('5', 'List of Integers', [1, 2, 1, 2]));
  });
});

describe('List.replace / List.replace_first', () => {
  const script = `
      @replaceAll = -> result: List.replace([1,2,1,2,1], 1, 9)
      @replaceFirst = -> result: List.replace_first([1,2,1,2,1], 1, 9)
      @replaceMiss = -> result: List.replace([1,2,3], 99, 0)
      @replaceBang = { ns List of Integers! = [1,2,1]; ns.replace!(1, 9); -> result: ns }
  `;
  it('replace all', async () => {
    await expectBehavior(script, inp('1', '@replaceAll'), out('1', 'List of Integers', [9, 2, 9, 2, 9]));
  });
  it('replace first', async () => {
    await expectBehavior(script, inp('2', '@replaceFirst'), out('2', 'List of Integers', [9, 2, 1, 2, 1]));
  });
  it('replace miss leaves list intact', async () => {
    await expectBehavior(script, inp('3', '@replaceMiss'), out('3', 'List of Integers', [1, 2, 3]));
  });
  it('replace! mutates', async () => {
    await expectBehavior(script, inp('4', '@replaceBang'), out('4', 'List of Integers', [9, 2, 9]));
  });
});

// ─── Tier 1: combine ──────────────────────────────────────────────────────────

// append / prepend are single-element; concat is the list+list operation.
describe('List.concat / List.append / List.prepend', () => {
  const script = `
      @concat  = -> result: List.concat([1,2], [3,4])
      @append  = -> result: List.append([1,2], 3)
      @prepend = -> result: List.prepend([2,3], 1)
      @concatBang  = { ns List of Integers! = [1,2]; ns.concat!([3,4]); -> result: ns }
      @appendBang  = { ns List of Integers! = [1,2]; ns.append!(3); -> result: ns }
      @prependBang = { ns List of Integers! = [2,3]; ns.prepend!(1); -> result: ns }
  `;
  it('concat (list + list)', async () => {
    await expectBehavior(script, inp('1', '@concat'), out('1', 'List of Integers', [1, 2, 3, 4]));
  });
  it('append (single element)', async () => {
    await expectBehavior(script, inp('2', '@append'), out('2', 'List of Integers', [1, 2, 3]));
  });
  it('prepend (single element)', async () => {
    await expectBehavior(script, inp('3', '@prepend'), out('3', 'List of Integers', [1, 2, 3]));
  });
  it('concat! mutates', async () => {
    await expectBehavior(script, inp('4', '@concatBang'), out('4', 'List of Integers', [1, 2, 3, 4]));
  });
  it('append! mutates', async () => {
    await expectBehavior(script, inp('5', '@appendBang'), out('5', 'List of Integers', [1, 2, 3]));
  });
  it('prepend! mutates', async () => {
    await expectBehavior(script, inp('6', '@prependBang'), out('6', 'List of Integers', [1, 2, 3]));
  });
});

// concat is variadic — accepts 2+ list arguments and folds left-to-right.
describe('List.concat — variadic', () => {
  const script = `
      @three = -> result: List.concat([1,2], [3,4], [5,6])
      @four  = -> result: List.concat([1], [2], [3], [4])
      @withEmpty
        =
        empty List of Integers = []
        -> result: List.concat([1,2], empty, [3,4])
      @bang3
        =
        ns List of Integers! = [1,2]
        ns.concat!([3,4], [5,6])
        -> result: ns
  `;
  it('three lists', async () => {
    await expectBehavior(script, inp('1', '@three'), out('1', 'List of Integers', [1, 2, 3, 4, 5, 6]));
  });
  it('four lists', async () => {
    await expectBehavior(script, inp('2', '@four'), out('2', 'List of Integers', [1, 2, 3, 4]));
  });
  it('empty list in the middle', async () => {
    await expectBehavior(script, inp('3', '@withEmpty'), out('3', 'List of Integers', [1, 2, 3, 4]));
  });
  it('concat! mutates with multiple args', async () => {
    await expectBehavior(script, inp('4', '@bang3'), out('4', 'List of Integers', [1, 2, 3, 4, 5, 6]));
  });
});

// + on Lists is a synonym for List.concat — pure, returns new list.
describe('+ operator on Lists', () => {
  const script = `
      @plus = -> result: [1,2] + [3,4]
      @plusRef
        =
        a List of Integers = [1, 2]
        b List of Integers = [3, 4]
        -> result: a + b
      @plusChain = -> result: [1] + [2] + [3]
  `;
  it('list + list returns new list', async () => {
    await expectBehavior(script, inp('1', '@plus'), out('1', 'List of Integers', [1, 2, 3, 4]));
  });
  it('list + list with refs', async () => {
    await expectBehavior(script, inp('2', '@plusRef'), out('2', 'List of Integers', [1, 2, 3, 4]));
  });
  it('chained + (left-associative)', async () => {
    await expectBehavior(script, inp('3', '@plusChain'), out('3', 'List of Integers', [1, 2, 3]));
  });
});

// ─── Tier 2: list-only ────────────────────────────────────────────────────────

describe('List.flatten / List.unique / List.sort', () => {
  const script = `
      @flatten = -> result: List.flatten([[1,2],[3],[4,5]])
      @flattenEmpty = { empty List of Lists of Integers = []; -> result: List.flatten(empty) }
      @unique  = -> result: List.unique([1,2,2,3,3,3,4])
      @sort    = -> result: List.sort([3,1,4,1,5,9,2,6])
      @sortBang = { ns List of Integers! = [3,1,2]; ns.sort!; -> result: ns }
  `;
  it('flatten one level', async () => {
    await expectBehavior(script, inp('1', '@flatten'), out('1', 'List of Integers', [1, 2, 3, 4, 5]));
  });
  it('flatten empty', async () => {
    await expectBehavior(script, inp('2', '@flattenEmpty'), out('2', 'List of Integers', []));
  });
  it('unique dedup', async () => {
    await expectBehavior(script, inp('3', '@unique'), out('3', 'List of Integers', [1, 2, 3, 4]));
  });
  it('sort ascending', async () => {
    await expectBehavior(script, inp('4', '@sort'), out('4', 'List of Integers', [1, 1, 2, 3, 4, 5, 6, 9]));
  });
  it('sort! mutates', async () => {
    await expectBehavior(script, inp('5', '@sortBang'), out('5', 'List of Integers', [1, 2, 3]));
  });
});

describe('List.join (List of Texts → Text)', () => {
  const script = `
      @join = -> result: List.join(["a","b","c"], "-")
      @joinEmpty = { empty List of Texts = []; -> result: List.join(empty, ",") }
      @joinSingle = -> result: List.join(["only"], "-")
  `;
  it('join with sep', async () => {
    await expectBehavior(script, inp('1', '@join'), out('1', 'Text', 'a-b-c'));
  });
  it('join empty list', async () => {
    await expectBehavior(script, inp('2', '@joinEmpty'), out('2', 'Text', ''));
  });
  it('join single', async () => {
    await expectBehavior(script, inp('3', '@joinSingle'), out('3', 'Text', 'only'));
  });
});

// ─── Equality semantics through _bv_eq ────────────────────────────────────────

describe('List equality semantics — _bv_eq', () => {
  const script = `
      @containsDecimal
        =
        x Decimal = 1.00
        nums List of Decimals = [1.0, 2.0]
        -> result: List.contains(nums, x)

      @nestedListContains
        =
        target List of Integers = [1, 2]
        nested List of Lists of Integers = [[1,2], [3,4]]
        -> result: List.contains(nested, target)
  `;
  it('Decimal value-equality (1.0 == 1.00)', async () => {
    await expectBehavior(script, inp('1', '@containsDecimal'), out('1', 'Boolean', true));
  });
  it('nested list — recursive structural equality', async () => {
    await expectBehavior(script, inp('2', '@nestedListContains'), out('2', 'Boolean', true));
  });
});
