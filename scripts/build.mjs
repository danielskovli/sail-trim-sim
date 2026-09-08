// Stages the deployable files in dist/ for the Azure Static Web Apps workflow.
// This is a plain allowlist copy, not a compile step: the app is served from the repo root in
// development, and dist/ exists only so that tests, docs, tooling and repository metadata never
// reach the web server. Anything new that the page loads must be added to DEPLOYABLE.
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const DEPLOYABLE = ['index.html', 'styles.css', 'src', 'staticwebapp.config.json'];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const entry of DEPLOYABLE) {
  cpSync(join(root, entry), join(dist, entry), {
    recursive: true,
    filter: (path) => !basename(path).startsWith('.'), // no .DS_Store and friends
  });
}

const files = readdirSync(dist, { recursive: true })
  .filter((rel) => statSync(join(dist, rel)).isFile())
  .sort();
console.log(`dist/ staged with ${files.length} files:\n  ${files.join('\n  ')}`);
