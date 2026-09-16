/**
 * Copies `documentation/docs/legal/*.md` (the source of truth — what Docusaurus builds, what the
 * owner edits) onto `backend/src/legal/data/*.md` (the runtime copy `legal-documents.ts` actually
 * reads, embedded into the API at build time via `nest-cli.json`'s own `**\/*.md` asset rule — see
 * that file's header for why a copy exists at all rather than a `../../../documentation/...` relative
 * read: `sourceRoot` is `backend/src`, so nothing outside it survives into `dist/`, and a hosted
 * deployment ships `backend/` alone, without the sibling `documentation/` checkout).
 *
 * Run by hand after editing a document in `documentation/docs/legal/`:
 *   cd backend && npm run legal:sync
 *
 * `legal/docs-sync.spec.ts` is the other half of this: it fails the moment the two directories drift,
 * so a forgotten sync is caught by `npm test`, not discovered live.
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_DIR = join(__dirname, '..', '..', 'documentation', 'docs', 'legal');
const DEST_DIR = join(__dirname, '..', 'src', 'legal', 'data');

function main() {
  const files = readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.md'));
  if (files.length === 0) {
    throw new Error(`sync-legal-docs: no .md files found in ${SOURCE_DIR}`);
  }

  // Clean the destination first so a document renamed/removed at the source doesn't leave a stale,
  // orphaned copy behind that `legal-documents.ts` would keep serving forever.
  rmSync(DEST_DIR, { recursive: true, force: true });
  mkdirSync(DEST_DIR, { recursive: true });

  for (const file of files) {
    copyFileSync(join(SOURCE_DIR, file), join(DEST_DIR, file));
  }

  // eslint-disable-next-line no-console
  console.log(`sync-legal-docs: copied ${files.length} file(s) from ${SOURCE_DIR} to ${DEST_DIR}`);
}

main();
