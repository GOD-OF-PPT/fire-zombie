import { readdir, readFile, lstat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

// Vite only publishes its declared entry and public assets. Keep reports, sources and backups out.
const root = resolve('dist');
const allowed = /^(?:index\.html|favicon\.svg|models\/(?:[a-z_]+\.glb|ATTRIBUTION\.md|tripo\/(?:energy_vault\.glb|README\.md)))$/;
const files = [];
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, item.name);
    if ((await lstat(full)).isSymbolicLink()) throw new Error(`Release must not contain links: ${full}`);
    if (item.isDirectory()) {
      const directory = relative(root, full).replaceAll('\\', '/');
      if (!['models', 'models/tripo'].includes(directory)) throw new Error(`Unexpected release directory: ${directory}`);
      await walk(full);
    }
    else {
      const file = relative(root, full).replaceAll('\\', '/');
      if (!allowed.test(file)) throw new Error(`Unexpected release file: ${file}`);
      files.push(file);
    }
  }
}
await walk(root);
if (!files.includes('index.html')) throw new Error('Release is missing index.html');
const html = await readFile(join(root, 'index.html'), 'utf8');
if (/\b(?:innerHTML|outerHTML)\b/i.test(html)) throw new Error('Release must use DOM node rendering instead of innerHTML/outerHTML');
if (/(?:src|href)\s*=\s*["']\/(?!\/)/i.test(html)) throw new Error('Release contains a fixed root reference');
console.log(`Static release allowlist passed (${files.length} files; entry: index.html)`);
