#!/usr/bin/env node
/**
 * A scenario-driven stand-in for the `codex` binary (Phase 25).
 *
 * Bound at run time with DONNY_CODEX_BIN=<abs path to this file>; the behaviour is
 * chosen with FAKE_CODEX_SCENARIO. Every RECORD-02 status and both SEAM-05 outcomes
 * are reproducible here with no network, no Codex quota, and no logged-in session,
 * which is the whole evidence base for the contract's classifier.
 *
 * The spawnSync result shapes it has to be able to produce were measured on
 * Node v24.16.0 (25-RESEARCH.md, Grade A):
 *
 *   timeout kill   -> { status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' } }
 *   nonzero exit   -> { status: 7,    signal: null,      error: undefined }
 *   binary missing -> { status: null, signal: null,      error: { code: 'ENOENT' } }
 *   over maxBuffer -> { status: null, signal: 'SIGTERM', error: { code: 'ENOBUFS' } }
 *
 * The event vocabulary is the enum at tag rust-v0.153.4, which is exactly eight
 * variants; `item.failed` does NOT exist there despite the published docs listing it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

// fs.writeSync can short-write on a pipe, so every write loops to completion.
// Nothing is buffered through process.stdout, so nothing is lost at exit.
const writeAll = (fd, data) => {
  const buf = Buffer.from(data);
  let off = 0;
  while (off < buf.length) off += fs.writeSync(fd, buf, off);
};
const out = (s) => writeAll(1, s);
const err = (s) => writeAll(2, s);
const event = (obj) => out(JSON.stringify(obj) + '\n');

// ---------------------------------------------------------------------------
// 1. --version answers first, before anything else. The contract stamps the
//    observed version on every result (D-16), so this branch is hit on every run
//    and must never be reachable by a scenario.
// ---------------------------------------------------------------------------
if (argv.includes('--version')) {
  out('codex-cli ' + (process.env.FAKE_CODEX_VERSION || '0.153.4') + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 2. The -o path, which is where the verdict lives (SEAM-05).
// ---------------------------------------------------------------------------
const oIdx = argv.indexOf('-o');
const outPath = oIdx >= 0 && oIdx + 1 < argv.length ? argv[oIdx + 1] : null;

// ---------------------------------------------------------------------------
// 3. The real binary announces itself on stderr whenever stdin is not a TTY,
//    which is every spawn from a tool harness (lib.rs, Grade A). It is benign
//    noise once stdin is closed, and the contract's stderr handling has to
//    tolerate it rather than treat it as a failure - the line `2>/dev/null` at
//    review.md:144 was discarding.
// ---------------------------------------------------------------------------
err('Reading additional input from stdin...\n');

const THREAD_ID = '01a073d9-21a2-7422-a75f-34cc609270f1';
const USAGE = {
  input_tokens: 1200,
  cached_input_tokens: 0,
  cache_write_input_tokens: 0,
  output_tokens: 340,
  reasoning_output_tokens: 128,
};

const started = () => {
  event({ type: 'thread.started', thread_id: THREAD_ID });
  event({ type: 'turn.started' });
};
const completed = () => event({ type: 'turn.completed', usage: USAGE });
const failed = (message) => event({ type: 'turn.failed', error: { message } });

// A scenario the caller never named behaves as a working codex; a scenario the
// caller misspelled is loud, so a typo in a test cannot pass as a green run.
const scenario = process.env.FAKE_CODEX_SCENARIO || 'ok';

switch (scenario) {
  // -------------------------------------------------------------------------
  // The SEAM-05 case, and the reason this fixture exists at all.
  //
  // The agent_message event and the -o file carry DELIBERATELY DIFFERENT text.
  // openai/codex#19816 is open and maintainer etraut-openai stated on 2026-04-28
  // that it cannot be fixed in the Codex harness: with --output-schema set, every
  // assistant message in the sampling loop is schema-shaped, so an intermediate
  // progress note parses as a valid final result. Reading the -o file is the only
  // defence. Do NOT "simplify" these two strings into one - collapsing them
  // deletes the only test that can tell the two sources apart.
  // -------------------------------------------------------------------------
  case 'ok':
  case 'ok_json_verdict': {
    started();
    event({
      type: 'item.completed',
      item: { id: 'item_0', type: 'agent_message', text: 'INTERMEDIATE-NOT-THE-VERDICT' },
    });
    completed();
    const verdict =
      scenario === 'ok_json_verdict'
        ? (process.env.FAKE_CODEX_VERDICT ?? '')
        : 'FINAL-VERDICT-FROM-O-FILE\n';
    if (outPath) fs.writeFileSync(outPath, verdict);
    process.exit(0);
    break;
  }

  // exit 0 with a contentless success: the file IS created, with zero bytes.
  case 'ok_empty_o': {
    started();
    completed();
    if (outPath) fs.writeFileSync(outPath, '');
    err('Warning: no last agent message; wrote empty content to ' + outPath + '\n');
    process.exit(0);
    break;
  }

  // exit 0 and no -o file at all. Should not happen against the real binary;
  // the contract must still refuse to call it `ok`.
  case 'ok_missing_o': {
    started();
    completed();
    process.exit(0);
    break;
  }

  // The recorded 401 stream, replayed verbatim. Ten error events of retry
  // chatter around one terminal turn.failed.
  case 'auth': {
    out(fs.readFileSync(path.join(HERE, 'unauth-401.jsonl'), 'utf-8'));
    process.exit(1);
    break;
  }

  case 'quota': {
    started();
    failed(process.env.FAKE_CODEX_MESSAGE || '');
    process.exit(1);
    break;
  }

  case 'nonzero': {
    started();
    failed('something else entirely');
    process.exit(1);
    break;
  }

  // Config errors, a malformed --output-schema file, a failed git-repo check and a
  // bad thread id all exit before the event stream opens: no JSONL at all, ever.
  case 'no_jsonl': {
    err('Error loading config.toml: unknown configuration field\n');
    process.exit(1);
    break;
  }

  // Blocks in the kernel rather than on the event loop, so the parent's SIGTERM
  // is what ends it. A setTimeout would exit immediately (empty event loop) and a
  // busy loop would burn a core.
  case 'slow': {
    event({ type: 'thread.started', thread_id: THREAD_ID });
    const ms = Number(process.env.FAKE_CODEX_SLEEP_MS || 5000);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    process.exit(0);
    break;
  }

  // Past spawnSync's 1 MiB default maxBuffer, which the runtime punishes with a
  // SIGTERM and error.code ENOBUFS - indistinguishable from a timeout to any
  // classifier that only looks at status and signal (pitfall 1).
  case 'enobufs': {
    const n = Number(process.env.FAKE_CODEX_BYTES || 2200000);
    try {
      out('x'.repeat(n) + '\n');
    } catch {
      // The parent kills us mid-write in exactly the case this scenario exists
      // to produce; EPIPE here is the success condition, not a failure.
    }
    process.exit(0);
    break;
  }

  default: {
    err('fake-codex: unknown FAKE_CODEX_SCENARIO "' + scenario + '"\n');
    process.exit(2);
  }
}
