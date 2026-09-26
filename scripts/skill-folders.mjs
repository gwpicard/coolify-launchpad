// The skill folders under a skills directory: directories only, and no dot
// entries. Finder writes .DS_Store into any folder it opens, and git ignores
// it, so a Mac checkout can hold a stray file that a clean clone never has.
import { readdirSync } from 'node:fs';

export function skillFolders(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}
