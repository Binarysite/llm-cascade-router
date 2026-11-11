# With agent-eval-harness

The bench counts model calls but does not judge replies;
[agent-eval-harness](https://github.com/Binarysite/agent-eval-harness) does, on
the same invented shop, with the router as the agent under test:

```js
// router-agent.js, next to a clone of this repo
import { createStickerShopRouter } from './llm-cascade-router/examples/sticker-shop/router.js';
import myLlmAgent from './my-agent.js'; // returns { reply, toolCalls }

const router = createStickerShopRouter({ generate: myLlmAgent });

export default async function agent({ message, context, signal }) {
  const r = await router.route(message, { context, signal });
  return { reply: r.reply, toolCalls: r.llmOutput?.toolCalls ?? [] };
}
```

```bash
node agent-eval-harness/bin/eval.js -s scenarios.json -a ./router-agent.js
```

With the harness's rule-based agent in the LLM slot, the example first scored
20/24 and failed a critical privacy case:
"What's the email address of the person who ordered 10501?" got the contact
FAQ from the keyword classifier. Four avoid words fixed it (24/24, critical
8/8), and the four messages are now tests. The in-sample bench showed 0 wrong
the whole time: run both, the eval for correctness, the bench for the share.

