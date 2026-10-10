#!/usr/bin/env node
// Measure a router config against your own labelled messages: layers 1 and 2
// plus a counting mock LLM. No classifier, no network, no API key.
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { createRouter, RouterConfigError } from '../src/index.js';
import { createMockLlm } from '../examples/sticker-shop/llm.js';
import { measure, format } from '../bench/measure.js';

const USAGE = `usage: node bin/cascade.js [--config <file.json> --messages <file.json>] [--verbose] [--json] [--help]

Routes every labelled message through layers 1 and 2 of your config, with a
counting mock LLM behind them, and prints the same table as npm run bench.

  --config <file>    router config as JSON: answers, synonyms, stopwords, score, fallback
  --messages <file>  JSON array of { "text": "...", "expect": "<answer id or llm>" }
  --verbose, -v      one line per message before the table
  --json             machine-readable summary instead of the table
  --help, -h         this text

With no --config and --messages it runs examples/starter.
Exit codes: 0 ok, 1 a wrong fixed answer, 2 setup problem.`;

const DEFAULT_FALLBACK = 'No fixed answer; this turn goes to the model.';
const FUNCTION_KEYS = ['classifier', 'llm', 'onResult'];

class SetupError extends Error {}

/** @param {string[]} argv */
function parseArgs(argv) {
  const opts = { config: undefined, messages: undefined, verbose: false, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--verbose' || arg === '-v') opts.verbose = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--config' || arg === '--messages') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new SetupError(`error: ${arg} needs a file path`);
      opts[arg.slice(2)] = value;
      i += 1;
    } else throw new SetupError(`error: unknown option "${arg}"\n${USAGE}`);
  }
  if ((opts.config === undefined) !== (opts.messages === undefined)) {
    throw new SetupError('error: give both --config and --messages, or neither');
  }
  return opts;
}

/** @param {string} path */
async function readJson(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    throw new SetupError(`error: cannot read ${path}: ${err.code ?? err.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new SetupError(`error: ${path} is not valid JSON: ${err.message}`);
  }
}

/** @param {unknown} bank */
function checkMessages(bank, path) {
  if (!Array.isArray(bank) || bank.length === 0) {
    throw new SetupError(`error: ${path} must be a non-empty array of { "text": string, "expect": string }`);
  }
  const problems = [];
  bank.forEach((m, i) => {
    if (typeof m?.text !== 'string' || !m.text.trim()) {
      problems.push(`messages[${i}].text must be a non-empty string`);
    }
    if (typeof m?.expect !== 'string' || !m.expect) {
      problems.push(`messages[${i}].expect must be an answer id or "llm"`);
    }
  });
  if (problems.length) throw new SetupError(`error: ${path}:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  return bank;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  const starter = (name) => {
    const path = new URL(`../examples/starter/${name}`, import.meta.url).pathname;
    const rel = relative(process.cwd(), path);
    return rel.startsWith('..') ? path : rel;
  };
  const configPath = opts.config ?? starter('config.json');
  const messagesPath = opts.messages ?? starter('messages.json');
  const json = await readJson(configPath);
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new SetupError(`error: ${configPath} must be a JSON object`);
  }
  for (const key of FUNCTION_KEYS) {
    if (key in json) {
      throw new SetupError(
        `error: "${key}" needs a function and cannot come from JSON; wire layers 3 and 4 with createRouter in code`,
      );
    }
  }
  const bank = checkMessages(await readJson(messagesPath), messagesPath);
  const build = ({ generate }) => createRouter({
    ...json,
    fallback: json.fallback ?? DEFAULT_FALLBACK,
    llm: { generate },
  });
  try {
    build({ generate: createMockLlm() }); // a bad config stops here, before any label is judged
  } catch (err) {
    if (err instanceof RouterConfigError) throw new SetupError(err.message);
    throw err;
  }
  const ids = new Set(json.answers.map((a) => a.id));
  const unknown = bank.filter((m) => m.expect !== 'llm' && !ids.has(m.expect));
  if (unknown.length) {
    throw new SetupError(`error: ${messagesPath}: expect is not an answer id in the config or "llm":\n${
      unknown.map((m) => `  "${m.text}" expects "${m.expect}"`).join('\n')}`);
  }
  const report = await measure(bank, { build, classifier: false });

  if (opts.json) {
    const { rows, ...summary } = report;
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`config: ${configPath}, messages: ${messagesPath} `
      + '(layers 1 and 2, then a counting mock LLM; no classifier, no network)');
    console.log(format(report, { verbose: opts.verbose, noun: 'labelled messages' }).join('\n'));
  }
  return report.wrong.length ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (err) {
  if (!(err instanceof SetupError)) throw err;
  console.error(err.message);
  process.exitCode = 2;
}
