// Fails `npm run typecheck` when a .d.ts file promises something the code
// does not provide: a missing export or an incompatible signature.
import * as impl from '../src/index.js';
import type * as decl from '../index.js';
import * as claudeImpl from '../src/adapters/claude.js';
import type * as claudeDecl from '../claude.js';
import * as evalImpl from '../src/eval.js';
import type * as evalDecl from '../eval.js';
import * as openAiImpl from '../src/adapters/openai-compatible.js';
import type * as openAiDecl from '../openai-compatible.js';

export const conforms: typeof decl = impl;
export const claudeConforms: typeof claudeDecl = claudeImpl;
export const evalConforms: typeof evalDecl = evalImpl;
export const openAiConforms: typeof openAiDecl = openAiImpl;
