#!/usr/bin/env node
// Route one message through the sticker shop and print the full result.
//   node examples/sticker-shop/ask.js "are the stickers waterproof?"
import { createStickerShopRouter } from './router.js';

const message = process.argv.slice(2).join(' ');
if (!message) {
  console.error('usage: node examples/sticker-shop/ask.js "<message>"');
  process.exit(2);
}
const result = await createStickerShopRouter().route(message);
console.log(JSON.stringify(result, null, 2));
