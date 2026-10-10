#!/usr/bin/env node
// Route messages through the sticker shop and show which layer answered.
//   npm run ask                                    four demo messages, one per layer
//   npm run ask -- "are the stickers waterproof?"  one message, the full result as JSON
import { createStickerShopRouter } from './router.js';

// From bench/messages.json: one message answered by each layer.
const DEMO = [
  'How long does shipping take?',
  'how fast do u shiping',
  'can I see a mockup to approve first',
  'My stickers arrived damaged, I want a refund',
];

const message = process.argv.slice(2).join(' ');
const router = createStickerShopRouter();
if (message) {
  console.log(JSON.stringify(await router.route(message), null, 2));
} else {
  console.log('sticker-shop example: keyword mock classifier, mock LLM\n');
  let cheap = 0;
  for (const text of DEMO) {
    const r = await router.route(text);
    if (!r.llmCalled) cheap += 1;
    console.log(`> ${text}`);
    for (const step of r.trace) console.log(`  ${step.layer.padEnd(11)}${step.outcome.padEnd(6)}${step.reason}`);
    const id = r.answerId ? ` (${r.answerId})` : '';
    console.log(`  answered by ${r.layer}${id}, ${r.llmCalled ? 'LLM called' : 'no LLM call'}\n`);
  }
  console.log(`${cheap} of ${DEMO.length} answered without the LLM.`);
}
