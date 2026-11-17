import { expectBehavior } from '../helpers.js';

describe('List methods', () => {
  const script = `
      // List.size / List.empty?
      @sizeFunc  = -> result: List.size([1, 2, 3])
      @sizeRef   = { ns *List of Integers = [1,2,3]; return result: ns.size }
      @sizeEmpty = { empty List of Integers = []; return result: List.size(empty) }
      @emptyTrue = { empty List of Integers = []; return result: List.empty?(empty) }
      @emptyFalse = -> result: List.empty?([1])

      // List.first / List.last / List.at
      @firstFunc = -> result: List.first([10, 20, 30])
      @lastFunc  = -> result: List.last([10, 20, 30])
      @atFunc    = -> result: List.at([10, 20, 30], 1)
      @atOver    = -> result: List.at([10, 20, 30], 99)
      @firstRef  = { ns *List of Integers = [42]; return result: ns.first }

      // List.slice / List.take / List.from
      @sliceMid  = -> result: List.slice([1,2,3,4,5], 1, 4)
      @sliceEnd  = -> result: List.slice([1,2,3,4,5], 2)
      @takeFirst = -> result: List.take([1,2,3,4,5], 3)
      @takeOver  = -> result: List.take([1,2], 99)
      @takeZero  = -> result: List.take([1,2,3], 0)
      @fromMid   = -> result: List.from([1,2,3,4,5], 2)
      @fromOver  = -> result: List.from([1,2], 99)
      @fromZero  = -> result: List.from([1,2,3], 0)
      @sliceBang = { ns *List of Integers = [1,2,3,4,5]; ns.slice!(1, 4); return result: ns }
      @takeBang  = { ns *List of Integers = [1,2,3,4,5]; ns.take!(2); return result: ns }
      @fromBang  = { ns *List of Integers = [1,2,3,4,5]; ns.from!(3); return result: ns }

      // List.contains / List.index_of
      @contTrue  = -> result: List.contains([1,2,3], 2)
      @contFalse = -> result: List.contains([1,2,3], 99)
      @indexHit  = -> result: List.index_of([10,20,30], 30)
      @indexMiss = -> result: List.index_of([10,20,30], 99)
      @containsRef = { ns *List of Integers = [1,2,3]; return result: ns.contains(2) }

      // List.starts_with / List.ends_with
      @swYes = -> result: List.starts_with([1,2,3,4], [1,2])
      @swNo  = -> result: List.starts_with([1,2,3,4], [2,3])
      @ewYes = -> result: List.ends_with([1,2,3,4], [3,4])
      @ewNo  = -> result: List.ends_with([1,2,3,4], [3,5])
      @swEmpty = { empty List of Integers = []; return result: List.starts_with([1,2], empty) }

      // List.before / List.after
      @beforeHit = -> result: List.before([1,2,3,4,5], 3)
      @afterHit  = -> result: List.after([1,2,3,4,5], 3)
      @beforeMiss = -> result: List.before([1,2,3], 99)
      @afterMiss  = -> result: List.after([1,2,3], 99)

      // List.reverse / List.repeat
      @rev      = -> result: List.reverse([1,2,3])
      @repeat3  = -> result: List.repeat([1,2], 3)
      @repeat0  = -> result: List.repeat([1,2], 0)
      @revBang  = { ns *List of Integers = [1,2,3]; ns.reverse!; return result: ns }
      @repeatBang = { ns *List of Integers = [1,2]; ns.repeat!(2); return result: ns }

      // List.replace / List.replace_first
      @replaceAll = -> result: List.replace([1,2,1,2,1], 1, 9)
      @replaceFirst = -> result: List.replace_first([1,2,1,2,1], 1, 9)
      @replaceMiss = -> result: List.replace([1,2,3], 99, 0)
      @replaceBang = { ns *List of Integers = [1,2,1]; ns.replace!(1, 9); return result: ns }

      // List.concat / List.append / List.prepend
      @concat  = -> result: List.concat([1,2], [3,4])
      @append  = -> result: List.append([1,2], 3)
      @prepend = -> result: List.prepend([2,3], 1)
      @concatBang  = { ns *List of Integers = [1,2]; ns.concat!([3,4]); return result: ns }
      @appendBang  = { ns *List of Integers = [1,2]; ns.append!(3); return result: ns }
      @prependBang = { ns *List of Integers = [2,3]; ns.prepend!(1); return result: ns }

      // List.concat — variadic
      @three = -> result: List.concat([1,2], [3,4], [5,6])
      @four  = -> result: List.concat([1], [2], [3], [4])
      @withEmpty
        =
        empty List of Integers = []
        return result: List.concat([1,2], empty, [3,4])
      @bang3
        =
        ns *List of Integers = [1,2]
        ns.concat!([3,4], [5,6])
        return result: ns

      // + operator on Lists
      @plus = -> result: [1,2] + [3,4]
      @plusRef
        =
        a List of Integers = [1, 2]
        b List of Integers = [3, 4]
        return result: a + b
      @plusChain = -> result: [1] + [2] + [3]

      // List.flatten / List.unique / List.sort
      @flatten = -> result: List.flatten([[1,2],[3],[4,5]])
      @flattenEmpty = { empty List of Lists of Integers = []; return result: List.flatten(empty) }
      @unique  = -> result: List.unique([1,2,2,3,3,3,4])
      @sort    = -> result: List.sort([3,1,4,1,5,9,2,6])
      @sortBang = { ns *List of Integers = [3,1,2]; ns.sort!; return result: ns }

      // List.join (List of Texts → Text)
      @join = -> result: List.join(["a","b","c"], "-")
      @joinEmpty = { empty List of Texts = []; return result: List.join(empty, ",") }
      @joinSingle = -> result: List.join(["only"], "-")

      // List equality semantics — _bv_eq
      @containsDecimal
        =
        x Decimal = 1.00
        nums List of Decimals = [1.0, 2.0]
        return result: List.contains(nums, x)

      @nestedListContains
        =
        target List of Integers = [1, 2]
        nested List of Lists of Integers = [[1,2], [3,4]]
        return result: List.contains(nested, target)
  `;

  // ═══════════════════════════════════════════════════════════════════════════════
  // List methods — pure (List.fn / *list.method) and bang (*list.method!).
  //
  // Equality semantics for contains/index_of/replace/before/after/starts_with/
  // ends_with route through _bv_eq: structural for primitives, value-equal for
  // Decimal, recursive for nested lists, identity for actor refs.
  //
  // Out-of-range indices clamp silently to match slice/take/from on Text/Blob.
  // ═══════════════════════════════════════════════════════════════════════════════


  // ─── Tier 1: meta + index access ──────────────────────────────────────────────

  it('List.size / List.empty? — List.size literal', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'sizeFunc', from: 'c' } }, { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 3 }, to: 'c' } });
  });
  it('List.size / List.empty? — ref.size', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'sizeRef', from: 'c' } }, { output: { id: '2', 'ty': { result: 'Integer' }, re: { result: 3 }, to: 'c' } });
  });
  it('List.size / List.empty? — size of empty', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'sizeEmpty', from: 'c' } }, { output: { id: '3', 'ty': { result: 'Integer' }, re: { result: 0 }, to: 'c' } });
  });
  it('List.size / List.empty? — empty? true', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'emptyTrue', from: 'c' } }, { output: { id: '4', 'ty': { result: 'Boolean' }, re: { result: true }, to: 'c' } });
  });
  it('List.size / List.empty? — empty? false', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'emptyFalse', from: 'c' } }, { output: { id: '5', 'ty': { result: 'Boolean' }, re: { result: false }, to: 'c' } });
  });

  it('List.first / List.last / List.at — first', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'firstFunc', from: 'c' } }, { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 10 }, to: 'c' } });
  });
  it('List.first / List.last / List.at — last', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'lastFunc', from: 'c' } }, { output: { id: '2', 'ty': { result: 'Integer' }, re: { result: 30 }, to: 'c' } });
  });
  it('List.first / List.last / List.at — at(1)', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'atFunc', from: 'c' } }, { output: { id: '3', 'ty': { result: 'Integer' }, re: { result: 20 }, to: 'c' } });
  });
  it('List.first / List.last / List.at — at out-of-range → null', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'atOver', from: 'c' } }, { output: { id: '4', 'ty': { result: 'Integer' }, re: { result: null }, to: 'c' } });
  });
  it('List.first / List.last / List.at — ref.first', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'firstRef', from: 'c' } }, { output: { id: '5', 'ty': { result: 'Integer' }, re: { result: 42 }, to: 'c' } });
  });

  // ─── Tier 1: index slicing ────────────────────────────────────────────────────

  it('List.slice / List.take / List.from — slice(1, 4)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'sliceMid', from: 'c' } }, { output: { id: '1', 'ty': { result: 'List of Integers' }, re: { result: [2, 3, 4] }, to: 'c' } });
  });
  it('List.slice / List.take / List.from — slice(2) — open end', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'sliceEnd', from: 'c' } }, { output: { id: '2', 'ty': { result: 'List of Integers' }, re: { result: [3, 4, 5] }, to: 'c' } });
  });
  it('List.slice / List.take / List.from — take(3)', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'takeFirst', from: 'c' } }, { output: { id: '3', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 3] }, to: 'c' } });
  });
  it('List.slice / List.take / List.from — take(99) clamps', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'takeOver', from: 'c' } }, { output: { id: '4', 'ty': { result: 'List of Integers' }, re: { result: [1, 2] }, to: 'c' } });
  });
  it('List.slice / List.take / List.from — take(0) → empty', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'takeZero', from: 'c' } }, { output: { id: '5', 'ty': { result: 'List of Integers' }, re: { result: [] }, to: 'c' } });
  });
  it('List.slice / List.take / List.from — from(2)', async () => {
    await expectBehavior(script, { input: { id: '6', op: 'fromMid', from: 'c' } }, { output: { id: '6', 'ty': { result: 'List of Integers' }, re: { result: [3, 4, 5] }, to: 'c' } });
  });
  it('List.slice / List.take / List.from — from(99) → empty', async () => {
    await expectBehavior(script, { input: { id: '7', op: 'fromOver', from: 'c' } }, { output: { id: '7', 'ty': { result: 'List of Integers' }, re: { result: [] }, to: 'c' } });
  });
  it('List.slice / List.take / List.from — from(0) — whole list', async () => {
    await expectBehavior(script, { input: { id: '8', op: 'fromZero', from: 'c' } }, { output: { id: '8', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 3] }, to: 'c' } });
  });
  it('List.slice / List.take / List.from — slice! mutates ref', async () => {
    await expectBehavior(script, { input: { id: '9', op: 'sliceBang', from: 'c' } }, { output: { id: '9', 'ty': { result: 'List of Integers' }, re: { result: [2, 3, 4] }, to: 'c' } });
  });
  it('List.slice / List.take / List.from — take! mutates ref', async () => {
    await expectBehavior(script, { input: { id: '10', op: 'takeBang', from: 'c' } }, { output: { id: '10', 'ty': { result: 'List of Integers' }, re: { result: [1, 2] }, to: 'c' } });
  });
  it('List.slice / List.take / List.from — from! mutates ref', async () => {
    await expectBehavior(script, { input: { id: '11', op: 'fromBang', from: 'c' } }, { output: { id: '11', 'ty': { result: 'List of Integers' }, re: { result: [4, 5] }, to: 'c' } });
  });

  // ─── Tier 1: predicates and search (uses _bv_eq) ──────────────────────────────

  it('List.contains / List.index_of — contains hit', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'contTrue', from: 'c' } }, { output: { id: '1', 'ty': { result: 'Boolean' }, re: { result: true }, to: 'c' } });
  });
  it('List.contains / List.index_of — contains miss', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'contFalse', from: 'c' } }, { output: { id: '2', 'ty': { result: 'Boolean' }, re: { result: false }, to: 'c' } });
  });
  it('List.contains / List.index_of — index_of hit', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'indexHit', from: 'c' } }, { output: { id: '3', 'ty': { result: 'Integer' }, re: { result: 2 }, to: 'c' } });
  });
  it('List.contains / List.index_of — index_of miss → -1', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'indexMiss', from: 'c' } }, { output: { id: '4', 'ty': { result: 'Integer' }, re: { result: -1 }, to: 'c' } });
  });
  it('List.contains / List.index_of — ref.contains', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'containsRef', from: 'c' } }, { output: { id: '5', 'ty': { result: 'Boolean' }, re: { result: true }, to: 'c' } });
  });

  it('List.starts_with / List.ends_with — starts_with hit', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'swYes', from: 'c' } }, { output: { id: '1', 'ty': { result: 'Boolean' }, re: { result: true }, to: 'c' } });
  });
  it('List.starts_with / List.ends_with — starts_with miss', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'swNo', from: 'c' } }, { output: { id: '2', 'ty': { result: 'Boolean' }, re: { result: false }, to: 'c' } });
  });
  it('List.starts_with / List.ends_with — ends_with hit', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'ewYes', from: 'c' } }, { output: { id: '3', 'ty': { result: 'Boolean' }, re: { result: true }, to: 'c' } });
  });
  it('List.starts_with / List.ends_with — ends_with miss', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'ewNo', from: 'c' } }, { output: { id: '4', 'ty': { result: 'Boolean' }, re: { result: false }, to: 'c' } });
  });
  it('List.starts_with / List.ends_with — starts_with empty prefix', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'swEmpty', from: 'c' } }, { output: { id: '5', 'ty': { result: 'Boolean' }, re: { result: true }, to: 'c' } });
  });

  it('List.before / List.after — before(3) → [1,2]', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'beforeHit', from: 'c' } }, { output: { id: '1', 'ty': { result: 'List of Integers' }, re: { result: [1, 2] }, to: 'c' } });
  });
  it('List.before / List.after — after(3) → [4,5]', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'afterHit', from: 'c' } }, { output: { id: '2', 'ty': { result: 'List of Integers' }, re: { result: [4, 5] }, to: 'c' } });
  });
  it('List.before / List.after — before miss → whole list', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'beforeMiss', from: 'c' } }, { output: { id: '3', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 3] }, to: 'c' } });
  });
  it('List.before / List.after — after miss → empty', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'afterMiss', from: 'c' } }, { output: { id: '4', 'ty': { result: 'List of Integers' }, re: { result: [] }, to: 'c' } });
  });

  // ─── Tier 1: transforms ───────────────────────────────────────────────────────

  it('List.reverse / List.repeat — reverse', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'rev', from: 'c' } }, { output: { id: '1', 'ty': { result: 'List of Integers' }, re: { result: [3, 2, 1] }, to: 'c' } });
  });
  it('List.reverse / List.repeat — repeat 3 times', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'repeat3', from: 'c' } }, { output: { id: '2', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 1, 2, 1, 2] }, to: 'c' } });
  });
  it('List.reverse / List.repeat — repeat 0 → empty', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'repeat0', from: 'c' } }, { output: { id: '3', 'ty': { result: 'List of Integers' }, re: { result: [] }, to: 'c' } });
  });
  it('List.reverse / List.repeat — reverse! mutates', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'revBang', from: 'c' } }, { output: { id: '4', 'ty': { result: 'List of Integers' }, re: { result: [3, 2, 1] }, to: 'c' } });
  });
  it('List.reverse / List.repeat — repeat! mutates', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'repeatBang', from: 'c' } }, { output: { id: '5', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 1, 2] }, to: 'c' } });
  });

  it('List.replace / List.replace_first — replace all', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'replaceAll', from: 'c' } }, { output: { id: '1', 'ty': { result: 'List of Integers' }, re: { result: [9, 2, 9, 2, 9] }, to: 'c' } });
  });
  it('List.replace / List.replace_first — replace first', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'replaceFirst', from: 'c' } }, { output: { id: '2', 'ty': { result: 'List of Integers' }, re: { result: [9, 2, 1, 2, 1] }, to: 'c' } });
  });
  it('List.replace / List.replace_first — replace miss leaves list intact', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'replaceMiss', from: 'c' } }, { output: { id: '3', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 3] }, to: 'c' } });
  });
  it('List.replace / List.replace_first — replace! mutates', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'replaceBang', from: 'c' } }, { output: { id: '4', 'ty': { result: 'List of Integers' }, re: { result: [9, 2, 9] }, to: 'c' } });
  });

  // ─── Tier 1: combine ──────────────────────────────────────────────────────────

  // append / prepend are single-element; concat is the list+list operation.

  it('List.concat / List.append / List.prepend — concat (list + list)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'concat', from: 'c' } }, { output: { id: '1', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 3, 4] }, to: 'c' } });
  });
  it('List.concat / List.append / List.prepend — append (single element)', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'append', from: 'c' } }, { output: { id: '2', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 3] }, to: 'c' } });
  });
  it('List.concat / List.append / List.prepend — prepend (single element)', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'prepend', from: 'c' } }, { output: { id: '3', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 3] }, to: 'c' } });
  });
  it('List.concat / List.append / List.prepend — concat! mutates', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'concatBang', from: 'c' } }, { output: { id: '4', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 3, 4] }, to: 'c' } });
  });
  it('List.concat / List.append / List.prepend — append! mutates', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'appendBang', from: 'c' } }, { output: { id: '5', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 3] }, to: 'c' } });
  });
  it('List.concat / List.append / List.prepend — prepend! mutates', async () => {
    await expectBehavior(script, { input: { id: '6', op: 'prependBang', from: 'c' } }, { output: { id: '6', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 3] }, to: 'c' } });
  });

  // concat is variadic — accepts 2+ list arguments and folds left-to-right.

  it('List.concat — variadic — three lists', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'three', from: 'c' } }, { output: { id: '1', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 3, 4, 5, 6] }, to: 'c' } });
  });
  it('List.concat — variadic — four lists', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'four', from: 'c' } }, { output: { id: '2', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 3, 4] }, to: 'c' } });
  });
  it('List.concat — variadic — empty list in the middle', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'withEmpty', from: 'c' } }, { output: { id: '3', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 3, 4] }, to: 'c' } });
  });
  it('List.concat — variadic — concat! mutates with multiple args', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'bang3', from: 'c' } }, { output: { id: '4', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 3, 4, 5, 6] }, to: 'c' } });
  });

  // + on Lists is a synonym for List.concat — pure, returns new list.

  it('+ operator on Lists — list + list returns new list', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'plus', from: 'c' } }, { output: { id: '1', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 3, 4] }, to: 'c' } });
  });
  it('+ operator on Lists — list + list with refs', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'plusRef', from: 'c' } }, { output: { id: '2', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 3, 4] }, to: 'c' } });
  });
  it('+ operator on Lists — chained + (left-associative)', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'plusChain', from: 'c' } }, { output: { id: '3', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 3] }, to: 'c' } });
  });

  // ─── Tier 2: list-only ────────────────────────────────────────────────────────

  it('List.flatten / List.unique / List.sort — flatten one level', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'flatten', from: 'c' } }, { output: { id: '1', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 3, 4, 5] }, to: 'c' } });
  });
  it('List.flatten / List.unique / List.sort — flatten empty', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'flattenEmpty', from: 'c' } }, { output: { id: '2', 'ty': { result: 'List of Integers' }, re: { result: [] }, to: 'c' } });
  });
  it('List.flatten / List.unique / List.sort — unique dedup', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'unique', from: 'c' } }, { output: { id: '3', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 3, 4] }, to: 'c' } });
  });
  it('List.flatten / List.unique / List.sort — sort ascending', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'sort', from: 'c' } }, { output: { id: '4', 'ty': { result: 'List of Integers' }, re: { result: [1, 1, 2, 3, 4, 5, 6, 9] }, to: 'c' } });
  });
  it('List.flatten / List.unique / List.sort — sort! mutates', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'sortBang', from: 'c' } }, { output: { id: '5', 'ty': { result: 'List of Integers' }, re: { result: [1, 2, 3] }, to: 'c' } });
  });

  it('List.join (List of Texts → Text) — join with sep', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'join', from: 'c' } }, { output: { id: '1', 'ty': { result: 'Text' }, re: { result: 'a-b-c' }, to: 'c' } });
  });
  it('List.join (List of Texts → Text) — join empty list', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'joinEmpty', from: 'c' } }, { output: { id: '2', 'ty': { result: 'Text' }, re: { result: '' }, to: 'c' } });
  });
  it('List.join (List of Texts → Text) — join single', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'joinSingle', from: 'c' } }, { output: { id: '3', 'ty': { result: 'Text' }, re: { result: 'only' }, to: 'c' } });
  });

  // ─── Equality semantics through _bv_eq ────────────────────────────────────────

  it('List equality semantics — _bv_eq — Decimal value-equality (1.0 == 1.00)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'containsDecimal', from: 'c' } }, { output: { id: '1', 'ty': { result: 'Boolean' }, re: { result: true }, to: 'c' } });
  });
  it('List equality semantics — _bv_eq — nested list — recursive structural equality', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'nestedListContains', from: 'c' } }, { output: { id: '2', 'ty': { result: 'Boolean' }, re: { result: true }, to: 'c' } });
  });
});
