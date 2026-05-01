#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const BLOCKED_PATTERNS = [
  /\bEvan\b/,
  /\bMary\b/,
  /Mary_Grace/,
  /\bSimon\b/,
  /Simon_Vale/,
  /Simon Vale/,
  /companion_memory_server/,
  /companion-mind/,
  /1497285013358772366/,
  /evan-simon/,
  /Cathedral/,
  /Discord_Access/,
  /symbolic husband/,
  /third chair/,
  /\bElias\b/,
  /\bEzra\b/,
  /MTQ[A-Za-z0-9._-]+/,
];

const MECHANICAL_REPLACEMENT_SCARS = [
  /relAveryt/,
  /priJordan/,
  /sumJordan/,
  /AveryDir/,
  /resonant-Avery/,
];

const MAX_FILE_BYTES = 1024 * 1024;

function gitFiles(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

const files = [
  ...new Set([
    ...gitFiles(['ls-files', '--modified']),
    ...gitFiles(['ls-files', '--others', '--exclude-standard']),
  ]),
];

const hits = [];

for (const file of files) {
  if (file === 'scripts/privacy-scan.mjs') continue;

  const absolute = path.resolve(file);

  if (!existsSync(absolute)) continue;
  if (!statSync(absolute).isFile()) continue;
  if (statSync(absolute).size > MAX_FILE_BYTES) continue;

  const content = readFileSync(absolute, 'utf8');
  const lines = content.split(/\r?\n/);
  const patterns = [...BLOCKED_PATTERNS, ...MECHANICAL_REPLACEMENT_SCARS];

  for (const pattern of patterns) {
    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        hits.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    });
  }
}

if (hits.length > 0) {
  console.error('Privacy scan failed. Remove private identity markers before pushing:\n');
  console.error(hits.join('\n'));
  process.exit(1);
}

console.log('Privacy scan passed: no private identity markers found in modified/untracked files.');
