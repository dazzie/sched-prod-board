// Copies app/ to dist/ and stamps the build's git sha into it (R6).
// The sha is HEAD, so commit first: a dirty tree would name a build that does not match its commit.
import { execSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const run = (command) => execSync(command, { encoding: 'utf8' }).trim();
const allowDirty = process.argv.includes('--allow-dirty');
if (run('git status --porcelain -- app') && !allowDirty) {
  console.error('app/ has uncommitted changes. Commit first, or pass --allow-dirty for a local try.');
  process.exit(1);
}
const sha = run('git rev-parse HEAD');

rmSync('dist', { recursive: true, force: true });
cpSync('app', 'dist', { recursive: true });
const page = readFileSync('dist/index.html', 'utf8');
if (!page.includes('__BUILD_SHA__')) throw new Error('index.html has no __BUILD_SHA__ to stamp');
writeFileSync('dist/index.html', page.replaceAll('__BUILD_SHA__', sha));
console.log(`dist/ built at ${sha}`);
