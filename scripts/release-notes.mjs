#!/usr/bin/env node
// Prints the CHANGELOG.md section for a version (default: package.json's), for release notes.
//   node scripts/release-notes.mjs [version]
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const version = process.argv[2] || JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).version;
const lines = readFileSync(new URL('CHANGELOG.md', root), 'utf8').split('\n');
const start = lines.findIndex((l) => l.trim() === `## ${version}`);
if (start < 0) {
  console.error(`CHANGELOG.md has no "## ${version}" section`);
  process.exit(1);
}
const rest = lines.slice(start + 1);
const end = rest.findIndex((l) => /^## /.test(l));
const body = (end < 0 ? rest : rest.slice(0, end))
  .map((l) => l.replace(/^- [0-9a-f]{7,40}: /, '- ')) // changesets prefixes each entry with its commit hash
  .join('\n')
  .trim();
console.log(body || `Sangeet ${version}`);
