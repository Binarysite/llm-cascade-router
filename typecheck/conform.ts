// Fails `npm run typecheck` when a .d.ts file promises something the code
// does not provide: a missing export or an incompatible signature.
import * as impl from '../src/index.js';
import type * as decl from '../index.js';
import * as claudeImpl from '../src/adapters/claude.js';
import type * as claudeDecl from '../claude.js';

export const conforms: typeof decl = impl;
export const claudeConforms: typeof claudeDecl = claudeImpl;
