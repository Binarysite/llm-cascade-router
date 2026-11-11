# Contributing

This is a small library with a narrow job: answer repeat questions without a model call,
and never give a fixed answer to the wrong question.

## Scope

In: the four layers, config validation, the trace, the adapters, the eval helpers, the
example and the benches. Out, on purpose: embeddings, a semantic cache, conversation history in the local
layers, a pluggable layer list and runtime dependencies. For anything else, open an issue
first so we agree on the shape before you write code.

## Checks

Node 22 or newer. `npm ci` installs only TypeScript, for the type checks. CI runs these on
Node 22 and 24, so run them before you open a pull request:

```bash
npm ci
npm run lint
npm run typecheck
npm audit --omit=dev --audit-level=high
npm run clinc:fetch  # CLINC150 at a pinned commit; the tests then rerun its local bench
npm run coverage   # npm test with a floor of 95% lines and 90% branches on src/
npm run bench      # exits 1 on a wrong fixed answer in the in-sample set
npm run measure    # the starter config against its ten messages
```

## Changes

- One test per change, in `test/`, with `node:test`. A bug fix starts with a test that fails.
- Update the `.d.ts` files for public API changes. If a command's output changes, run
  `node scripts/readme-outputs.mjs`; a test fails while a README block is stale.
- Do not edit the example's vocabulary to make `bench/held-out.json` score better, or the
  file itself; see [DESIGN.md](docs/DESIGN.md#the-held-out-set).
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/), one change
  per commit. Add a line under Unreleased in `CHANGELOG.md` for anything a user would notice.
- House style: no em dashes in prose.
- Keep it simple: no new dependency, and no abstraction before its second use.
