# Security policy

## Supported versions

Only the latest minor release gets fixes. Today that is 0.2.x.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability. Use GitHub's private vulnerability
reporting: open the repository's **Security** tab and choose **Report a vulnerability**.
That creates a private advisory that only the maintainer can read.

Include the version or commit, a config and a message that reproduce it, what you expected
and what happened. Use invented data: do not attach real customer messages or real keys.

This is a one-person project, so there is no bug bounty and no guaranteed response time. A
confirmed issue gets a fix and a mention in the [changelog](CHANGELOG.md).

## Supply chain

- **No runtime dependencies.** CI runs `npm audit --omit=dev --audit-level=high`. The only
  dev dependencies are TypeScript and the Node types.
- **Actions are pinned by commit SHA**, with the version in a comment, and Dependabot keeps
  them current. CI and CodeQL run with read-only permissions, and CodeQL's job adds only
  `security-events: write`.
- **CodeQL** scans the JavaScript on every push to `main`, on pull requests and weekly.
- **`main` rejects force pushes and branch deletion**, through a repository ruleset that has
  no bypass. It does not require a pull request or status checks: the maintainer pushes
  directly.
- There is no npm package. The v0.2.1 tag is installed from GitHub.

## Data flow

The router has no runtime dependencies and sends nothing anywhere by itself. Layers 1 and 2
run in memory. What leaves your process depends on what you put in the two slots:

- **Your `classify` and `generate` functions** receive `{ message, context, signal }` (the
  classifier also gets `choices`) and do whatever they do. `context` is passed through
  untouched, so keep personal data out of it unless both may see it.
- **`createClaudeClassifier`** sends the Anthropic Messages API its system instructions, the
  id and `description` of every answer (the first phrase when no description is set) and the
  user's message. It does not send `context` or the `reply` strings.
- **`createClaudeLlm`** sends the user's message, its `system` prompt if you set one, and the
  earlier turns in `context.messages` if you pass them. It sends nothing else from `context`.
- **`createOpenAiCompatibleClassifier` and `createOpenAiCompatibleLlm`** send the same data
  as the Claude adapters, to `{baseUrl}/chat/completions`, plus anything in `extraBody`. The
  key comes from `apiKey` or `OPENAI_API_KEY` and goes only in the `authorization` header.
- **The Claude API key** is read from `apiKey` or the `ANTHROPIC_API_KEY` environment variable and
  goes only in the `x-api-key` header of the request. `url` overrides the endpoint for tests;
  the key is sent there too, so point it only at hosts you trust. An HTTP error carries the
  status code and, when it is a plain identifier, the provider's error type; the response body
  is never copied into it.
- **Results** from layers 1 to 3 carry config text, numbers and the chosen id, not the
  message. `llmOutput` is whatever `generate` returned, a custom classifier's `usage` is copied
  as given, an unknown choice is cut to 60 characters, and an error thrown by an injected
  function keeps its name and the first 200 characters of its message. Treat the result of a real LLM turn as sensitive in logs.

See the [threat model](docs/DESIGN.md#threat-model) for what a hostile message can and cannot
do. The router is not a safety layer: put injection and personal-data checks before it.
