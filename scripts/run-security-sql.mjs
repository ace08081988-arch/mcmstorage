#!/usr/bin/env node
// Verbose local runner for the security RLS SQL suite.
//
// Usage:
//   node scripts/run-security-sql.mjs                       # run full suite, colored output
//   node scripts/run-security-sql.mjs --verbose             # + psql VERBOSITY=verbose (SQLSTATE, DETAIL, HINT, CONTEXT)
//   node scripts/run-security-sql.mjs --block=12            # slice: only block 12 (+ setup + rollback)
//   node scripts/run-security-sql.mjs --block=11,12,13 -v   # multiple blocks, verbose
//   node scripts/run-security-sql.mjs --file=path.sql -v    # override target file
//
// Flags:
//   -v, --verbose   Enable psql VERBOSITY=verbose so failures print SQLSTATE / MESSAGE / DETAIL / HINT / CONTEXT lines
//                   on their own, and echo every notice (PASS/SKIP) with color.
//   --block=N[,M]   Only run the listed `-- N)` blocks. Header setup (BEGIN..first block) and the trailing
//                   ROLLBACK/COMMIT are always included so the transaction closes cleanly.
//   --file=PATH     Use a different SQL file (default: supabase/tests/security_rls_authz.sql).
//   --keep-tmp      Do not delete the temporary sliced file (prints its path).
//
// Exit codes: 0 = suite passed, 1 = psql failed (assertion or SQL error), 2 = usage error.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flags = { verbose: false, blocks: null, file: 'supabase/tests/security_rls_authz.sql', keepTmp: false };

for (const a of args) {
  if (a === '-v' || a === '--verbose') flags.verbose = true;
  else if (a === '--keep-tmp') flags.keepTmp = true;
  else if (a.startsWith('--block=')) flags.blocks = a.slice(8).split(',').map((s) => s.trim()).filter(Boolean);
  else if (a.startsWith('--file=')) flags.file = a.slice(7);
  else if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
  else { console.error(`unknown flag: ${a}`); printHelp(); process.exit(2); }
}

function printHelp() {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n'));
}

const C = process.stdout.isTTY ? {
  reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m',
} : { reset: '', dim: '', red: '', green: '', yellow: '', cyan: '', bold: '' };

// Build the target file (either the full suite, or a slice with just the requested blocks).
let targetFile = flags.file;
let tmpFile = null;

if (flags.blocks && flags.blocks.length) {
  const src = readFileSync(flags.file, 'utf8').split('\n');
  const blockHeaderRe = /^-- \s*(\d+[a-z]?)\)/; // matches "-- 12)" and "-- 12a)"
  const blockSepRe = /^-- -{5,}\s*$/;
  const wanted = new Set(flags.blocks);

  // Locate header end (first block marker) so we always include BEGIN + helper fns.
  let firstBlockLine = src.findIndex((l) => blockHeaderRe.test(l));
  if (firstBlockLine < 0) { console.error('could not find any "-- N)" block marker in target file'); process.exit(2); }

  const header = src.slice(0, firstBlockLine);
  const body = src.slice(firstBlockLine);

  // Walk body, buffering per block. A block ends when the next block header appears.
  const out = [...header];
  let keep = false;
  let sawAny = false;
  for (const line of body) {
    const m = line.match(blockHeaderRe);
    if (m) {
      // Match any block whose id STARTS with a requested number (e.g. --block=12 keeps 12, 12a..12g).
      keep = [...wanted].some((w) => m[1] === w || m[1].startsWith(w));
      if (keep) sawAny = true;
    }
    // ROLLBACK / COMMIT footer must always land in the output.
    if (/^\s*(ROLLBACK|COMMIT)\s*;/.test(line)) { out.push(line); continue; }
    if (keep || blockSepRe.test(line)) out.push(line);
  }

  if (!sawAny) {
    console.error(`${C.red}no blocks matched --block=${flags.blocks.join(',')}${C.reset}`);
    process.exit(2);
  }

  const dir = mkdtempSync(join(tmpdir(), 'sec-sql-'));
  tmpFile = join(dir, 'sliced.sql');
  writeFileSync(tmpFile, out.join('\n'), 'utf8');
  targetFile = tmpFile;
  console.log(`${C.dim}sliced ${flags.blocks.join(',')} → ${tmpFile}${C.reset}`);
}

// Build psql command.
const psqlArgs = ['-v', 'ON_ERROR_STOP=1'];
if (flags.verbose) {
  psqlArgs.push('-P', 'pager=off');
  psqlArgs.push('-v', 'VERBOSITY=verbose');
  // Ensure notices (PASS/SKIP lines) appear.
  psqlArgs.push('-v', 'ECHO_ERRORS=on');
}
psqlArgs.push('-f', targetFile);

// PGOPTIONS is honored by libpq; force test.can_switch=on so runtime RLS blocks execute locally.
const env = { ...process.env };
env.PGOPTIONS = [env.PGOPTIONS || '', '-c test.can_switch=on', '-c client_min_messages=notice'].join(' ').trim();
if (flags.verbose) env.PSQL_EDITOR = env.PSQL_EDITOR || 'true';

console.log(`${C.cyan}▶ psql ${psqlArgs.join(' ')}${C.reset}`);
if (flags.verbose) console.log(`${C.dim}  PGOPTIONS=${env.PGOPTIONS}${C.reset}`);

// Stream psql output through a colorizer so PASS/FAIL/SKIP/SQLSTATE/DETAIL/HINT are easy to spot.
const child = spawnSync('psql', psqlArgs, { env, encoding: 'utf8' });

const decorate = (chunk) => {
  if (!chunk) return '';
  return chunk
    .split('\n')
    .map((line) => {
      if (/^psql:.*ERROR:/.test(line)) return `${C.red}${C.bold}${line}${C.reset}`;
      if (/\bFAIL\b/.test(line)) return `${C.red}${C.bold}${line}${C.reset}`;
      if (/^DETAIL:/.test(line)) return `${C.yellow}${line}${C.reset}`;
      if (/^HINT:/.test(line)) return `${C.cyan}${line}${C.reset}`;
      if (/^CONTEXT:/.test(line)) return `${C.dim}${line}${C.reset}`;
      if (/^(NOTICE|WARNING):/.test(line)) {
        if (/\bPASS\b/.test(line)) return `${C.green}${line}${C.reset}`;
        if (/\bSKIP\b/.test(line)) return `${C.yellow}${line}${C.reset}`;
        return `${C.dim}${line}${C.reset}`;
      }
      return line;
    })
    .join('\n');
};

process.stdout.write(decorate(child.stdout));
process.stderr.write(decorate(child.stderr));

if (tmpFile && !flags.keepTmp) { try { unlinkSync(tmpFile); } catch {} }

if (child.status !== 0) {
  console.error(`\n${C.red}${C.bold}✖ security SQL suite failed (exit ${child.status})${C.reset}`);
  if (!flags.verbose) {
    console.error(`${C.dim}  re-run with --verbose to see SQLSTATE / DETAIL / HINT / CONTEXT for each failure${C.reset}`);
  }
  process.exit(child.status || 1);
}
console.log(`${C.green}${C.bold}✔ security SQL suite passed${C.reset}`);