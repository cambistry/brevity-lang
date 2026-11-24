# Brevity / CAM / Bluster Project Memory

## Overview
- [Project overview](project_overview.md) — repo layout, the stack, CAM actor model, Brevity language basics (dated 2026-02 onward; notes/ supersedes)

### Lower stack layers
- [Bluster, trust types, topology, principals](project_stack_concepts.md) — wire protocol (JCS, BLAKE3, `bluster://`), `Signed of X` boundary types, node/vertex/edge, agent vs vertex

## User
- [Preferences and tooling](user_preferences.md) — terse, precise notes; "first pass" = substantive, not exhaustive; Tensile CLI lives outside this repo

## Key Design Decisions
- [Capability sigils](project_asterisk_refs.md) — evolution of `*` / `&` / `!`; v1 (2026-05-06) revives prefix `*` (write-cap ref) and `&` (read-only ref), deprecates postfix `Type!` for cells (see link)
- [Overload model](project_overload_model.md) — `=` create, `<<` append, `>>` prepend; Function() empty init; no Constructor() (2026-04-06)
- [DI model — injected actors](project_brevity_file_model.md) — a header entry injects an already-instantiated actor (`HTML`, `Svc`); full notation `*` or typed `*`, omission is shorthand (see link)
- [Service block terminology](project_service_block_terminology.md) — constructor's trailing block is the "service block" (not init/declarations/body); older docs still use old names (2026-04-16)
- [Subscription via multi-re](project_subscription_multi_re.md) — `subscribe` is a regular CAM op that keeps replying; same `id`, multiple `re`. Initial value = first re. No verb (see link)
- [CAM address translation](project_address_translation.md) — parent does translation (not sender); `#<alias selector>` delimiter (changed from `<<…>>` 2026-04-23) (see link)
- [Type/Class split](../notes/type-class-split-2026-04-25.md) — named actor constructors are Classes; Types are homeless portable BV Structure schemas (see link)
- [Return-type annotation dropped from braced bodies](../notes/return-type-inference-2026-05-06.md) — `} : Type` and `} as Type` after braced function body are parse errors (see link)
- [Vocabulary refactor — Class/Actor/Object/Value](../notes/vocabulary-refactor-2026-05-15.md) — closes the noun set after the Type/Class split (see link)
- [`return` keyword vs `->`, arrow/becomes unification](../notes/return-keyword-and-arrow-2026-10-26.md) — `return` = optional in-body yield word; `->` becomes pure params→body arrow (never "return (see link)
- [Lineal termination & implicit tail return](../notes/lineal-termination-implicit-return-2026-10-26.md) — QUALIFIES the "retire `->`" note: lineal bodies do NOT do implicit tail return today (`->` (see link)
- [Opre addresses as tokens](../notes/opre-addresses-as-tokens-2026-11-11.md) — proposal (2026-11-11): an address is space-delimited tokens; any characters (sigils included) are jus (see link)
- [Opre wire names](../notes/at-sigil-internal-and-quoted-names-2026-11-12.md) — decided 2026-11-12: public names bare on the wire (no `@`, ops too) (see link)
- [Protected names take a leading `.` on the wire — spelling SUPERSEDED by `~` 2026-11-12](../notes/protected-names-dot-prefix-2026-11-11.md) — decided 2026-11-11, wire level only: (see link)
- [Forward reads in constructor blocks](../notes/forward-reads-in-constructor-blocks-2026-11-11.md) — decided 2026-11-11: text order, addresses exist from start, the actor's own read-before-in (see link)
- [Cells as actors: ordering rule](../notes/cells-as-actors-ordering-2026-11-11.md) — proposal; T3 (call-scoped turns) decided 2026-11-11 but deferred: its token is a transaction co (see link)
- [`++` is the extends operator](../notes/class-extends-plusplus-2026-11-10.md) — replaces subclass `|` (2026-11-10): `(A ++ B ++ params) *{}`, `D = C++`, `D = A ++ B`, wrapped pare (see link)
- [Actorization as locality of behavior — bundling consequence](../notes/actorization-bundling-2026-05-15.md) — reframes actorization: not primarily about state/addressability, but (see link)

- [Reference fields + type authority tags](../notes/type-authority-address-tags-2026-10-26.md) — IMPLEMENTED js/rust/erlang (commits `b92a743`, `5a7b581`, `cc0223a`, `f586206`): Type fiel (see link)

- [Private names are lexical](../notes/private-names-lexical-2026-11-16.md) — DECIDED 2026-11-16: `#` visible in declaring scope + everything lexically inside (closures, inner class (see link)
- [Remote superclasses](../notes/remote-superclass-2026-11-16.md) — OPEN (2026-11-16): remote parent layer is an actor; inheritance becomes delegation (see link)
- [Actor literal `actor { }`](../notes/actor-literal-2026-11-17.md) — IMPLEMENTED 2026-11-17: braced `**{` retired (parse error) for `actor { }` (see link)
- [Class scope & inheritance](../notes/class-scope-and-inheritance-2026-11-16.md) — 2026-11-16, marked decided/direction/open: bare = closure (lexical or own merged names), `.` = pu (see link)
- [`use` — DI as its own declaration](../notes/use-di-2026-11-17.md) — DECIDED 2026-11-17: `use HTML, :document` anywhere in declaration scopes; static, hoisted to file manifest; binding lexical; always the host; retires `**` header + head-of-file rule
- [`use` entries are bindings](../notes/use-as-binding-2026-11-18.md) — IMPLEMENTED 2026-11-18: `use :div = HTML`, `use HTML::div` (shorthand, no `=`), `use d = HTML::div`; RHS resolves in host; `as` stays coercion (iface/`#`/ctor profile become `as` on source); quotes optional for names
- [Actors, not classes](../notes/actors-not-classes-2026-11-18.md) — IMPLEMENTED 2026-11-18: no classes, only actors; "class" = relationship with `new`; declared actors tagged `*`, type `Actor`; `Class` and `Self` retired (`class`, `self`); address replies array-wrapped
- [`base` is the parent layer](../notes/base-and-super-2026-11-19.md) — IMPLEMENTED 2026-11-19 (`dcd03df`): `super` → `base` (`base.x`, `base::x`, `base[T]::x`); `base` can't be declared/set
- [`super` — Ruby style](../notes/super-2026-11-19.md) — DECIDED 2026-11-19, not implemented: `super(args)`/bare `super` = current fn on the base; constructors build the base via `super` (every path or none; none only if full public interface defined); params no longer merged; class-block `super`; `class::base` = self.class.superclass
- [Implicit class block](../notes/implicit-class-block-2026-11-21.md) — IMPLEMENTED 2026-11-21 (`dd6884a`): every class has a class block, implicitly `^ { }`; a subclass's extends its parent's by delegation (local or remote), retiring block sharing (`membersInherited`); implicit blocks are never a base
- [Opre service doc & type encoding](../notes/opre-type-encoding-2026-11-21.md) — DECIDED 2026-11-21, not implemented: service publishes a JSON tree of addresses (`public`/`protected` ops as signature lists with `args`/`re`/`writes`, `types`, `extends`, `":T"` nodes, `":*"` instances); every type is an address string; generics `[params…, {"%t": name}]`, nested list = any number, `{"%opt": T}`; same encoding is the compiler's internal type form; wire `ty` unchanged; BV-text doc retired

## Feedback
- [Test style](feedback_test_style.md) — one script per describe, 1–2 runtime describes per file; use helpers.js directly (no in-file wrappers), literal input/output steps; read a neighbouring test first
- [No proper lambdas](feedback_no_proper_lambdas.md) — "lambdas" are functions in lambda notation, closures capturing `self`; don't special-case them in design rules
- [Rust cache — no routine clearing](feedback_rust_cache.md) — entries are dated/self-invalidating; don't clear as a routine step, only suspect if rust results are inexplicable
- [Rust scratch builds](feedback_rust_scratch_builds.md) — never set CARGO_TARGET_DIR to rust/w*/target; it polluted the test cache once (2026-10-29)
- [Check existing Brevity syntactic forms](feedback_brevity_check_existing_forms.md) — verify shapes against docs/tests before treating as new; I keep inventing "third envelope shapes" for forms that already exist
- [Design state goes in notes/](feedback_design_notes_location.md) — repo-visible design docs, not private memory; private memory holds pointers only
- [notes/ is for design, not progress](feedback_notes_no_git_state.md) — design discussions and decisions only; no git state, status, or session narration
- [Scope test runs](feedback_test_scope.md) — quick iteration can scope to `--selectProjects=js`; full `npm run test` before reporting done
- [Own lint errors](feedback_own_lint_errors.md) — always take responsibility for lint errors; fix them, don't argue provenance
- [Full suite runs](feedback_no_full_suite_runs.md) — smoke-test with a full `--selectProjects=js` run first, then `npm run test`; ONE TICKET AT A TIME: green > commit > next ticket, even when tickets arrive together; normal flow waits for acceptance before committing
- [`--selectProjects` eats paths](feedback_jest_select_projects.md) — use `--selectProjects=js --testPathPattern=…`; the space form runs the whole suite
- [No parallel test runs](feedback_no_parallel_test_runs.md) — one test run at a time, background included; concurrent runs tend to hang
- [No per-target test skipping](feedback_no_target_guards.md) — NEVER skip tests on any target by any mechanism (describe guards, jest.json excludeTests, path filters, file naming). Let them fail visibly.
- [Never drop failing tests](feedback_never_drop_failing_tests.md) — never remove/withhold a test case because it exposes a bug, even an out-of-scope one; keep it and fix the bug
- [Capitalization is convention](feedback_capitalization_is_convention.md) — never treat name capitalization as a syntax signal (e.g. "marks a class"); grammar stands on tokens + LF structure only
- [Tickets: describe, don't file](feedback_tickets.md) — give the user a pasteable ticket description; never create files in kanban/ (unused)
- [No blockquoted pasteables](feedback_no_blockquote_pasteables.md) — tickets and other copy/paste text go in a fenced code block, never `>` lines
- [Commit means commit](feedback_commit_means_commit.md) — when asked to commit, just commit; no tests or lint first, the user runs them
- [No unasked commits](feedback_no_unasked_commits.md) — never commit unless told to, in general; a past "commit" covers only that moment's work. Exception: self-supervised multi-ticket runs
- [Refusals are often gaps](feedback_refusals_are_gaps.md) — a transpiler "can't X yet" guard isn't a language rule; check, and credit existing runtime plumbing before scoping
- [Discuss git branching first](feedback_git_branching.md) — don't auto-create a branch on the default-branch convention; surface the branch-vs-commit-on-main choice and let the user decide. Still never push unasked.

- [Published cell is `@a`](feedback_published_cell_is_at_name.md) — inside its actor too; bare `a` is a private cell. A note's example isn't proof of a rule
- [`@name` is a distinct token](feedback_at_name_is_distinct_token.md) — inside an actor `a`, `@a`, `#a` are different labels (classes too) (see link)

## Project Origin
- [Cross-chain origin](project_origin_cross_chain.md) — Opre/CAM and Brevity grew out of work on blockchain cross-chain transactions (see link)

## Reference
- [Memory lives in the repo](reference_auto_memory_sync.md) — write all memories to `memory/` here, never the machine-local dir; local MEMORY.md is only a pointer

## Active Work
- [Active work](project_active_work.md) — per-thread status and note pointers (10-24 to 11-03); wire key `bv-a` → `ty`; session decisions belong in notes/
- [`from` names the calling scope](../notes/from-names-calling-scope-2026-11-14.md) — PROPOSAL, undecided (2026-11-14): every outgoing call's `from` = innermost named scope (` (see link)
- [`__add_trace__` on return](../notes/add-trace-on-return-2026-11-14.md) — design 2026-11-14: class may declare `__add_trace__`; BV MUST call it when a fn/ctor returns an actor tha (see link)
- [Opre colon separator](../notes/opre-colon-separator-2026-11-14.md) — DECIDED 2026-11-15, supersedes space separator + `.` head: `:` separates tokens, leading `:` = self (`:x`, `# (see link)
- [Class singleton forms](../notes/class-singleton-forms-2026-11-13.md) — trailing `(p) *{ } **{ }` is NOT sugar; nested `**{ new = (p) *{ } }` closes over class (see link)
- [Opre op chains, subops, bracketed args](../notes/opre-op-chains-2026-11-15.md) — PROPOSALS 2026-11-15: RPN `[args] op` chains (each step on prior result (see link)
- [No detectors for non-forms](feedback_no_migration_language.md) — unreleased, no users: delete special-case checks for abandoned/foreign syntax; let parser/resolver fail generically. No migration wording ever
- [No silent acceptance](feedback_no_silent_acceptance.md) — never skip/drop/discard unrecognised input; detectors were hiding accept-anything paths. Fix the general path; check what a newly-compiling form became
- [Constructor return-as retired](../notes/constructor-return-as-retired-2026-11-23.md) — DECIDED 2026-11-23, not implemented: a constructor's result is its actor; `return expr` (non-self) there is an error; `self as` is the only projection; supersedes self-becomes. Element extension `<div decls>` = `HTML::div ^ *{ }` is future direction
- [Frames that outlive their call](../notes/escaping-frames-2026-11-23.md) — PROPOSAL 2026-11-23: fn returning a live element leaves cells/closures; per-call frame addresses, hosted by declaring actor, released when last subscriber leaves
- [Subscribability](../notes/subscribability-2026-11-23.md) — PROPOSAL 2026-11-23: subscribable = reads an outside subscribable address, no writes, no made actor escapes (return/write/send; subscriptions exempt); open (a) forbid vs (b) replace-on-replay for fresh actors in result
- [Element extension](../notes/element-extension-2026-11-23.md) — PROPOSAL 2026-11-23: tag head with names = `HTML::div ^ { … }`, element is the receiver; `@name={ … }` publishes a fn (liked); `^{ … }` holds declarations (tentative); prefer layer in HTML host; replaces 04-27 lifting (`liftReactiveElements`)
- [Class-of `*` & self-return](../notes/class-of-and-self-return-2026-11-23.md) — DECIDED 2026-11-23, not implemented: `X:*` = class of X (reduced by whoever knows; `*` for declared actors); `$new` answered by the class `#<:1>`/`:`; self-return `ty: [':*']`; doc `":T"` = instance, `":T:*"`/`%self` retired, `instance` section; compiler never merges calls into chains
- [Opre tagged forms](../notes/opre-tagged-forms-2026-11-24.md) — DECIDED 2026-11-24, not implemented: `%` claimed in address position, not keys; `["%f", sig…]` (overloads), `["%or", …]` flat, `["%opt", T]`, `["%t", name, entries]`, `["%iface", node]`; anonymous shape = its entry list; open: "any number of"
