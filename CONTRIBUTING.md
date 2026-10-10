# Contributing

This is a small library with a narrow job: answer repeat questions without a model call,
and never give a fixed answer to the wrong question.

## Scope

In: the four layers, config validation, the trace, the Claude adapters, the example and the
bench. Out, on purpose: embeddings, a semantic cache, conversation history in the local
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
npm run coverage   # npm test with a floor of 95% lines and 90% branches on src/
npm run bench      # exits 1 on a wrong fixed answer in the in-sample set
npm run measure    # the starter config against its ten messages
```

## Changes

- One test per change, in `test/`, with `node:test`. A bug fix starts with a test that fails.
- Update `index.d.ts` or `claude.d.ts` for public API changes, and the README if a command
  or its output changes.
- Do not edit the example's vocabulary to make `bench/held-out.json` score better, or the
  file itself; see [DESIGN.md](docs/DESIGN.md#the-held-out-set).
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/), one change
  per commit. Add a line under Unreleased in `CHANGELOG.md` for anything a user would notice.
- Text files take no em dashes; the lint rejects them.
- Keep it simple: no new dependency, and no abstraction before its second use.
