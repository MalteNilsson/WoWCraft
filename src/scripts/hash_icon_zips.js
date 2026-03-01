/**
 * Hash icon zip files for cache-busting with immutable Cache-Control.
 * Renames materials.zip -> materials-abc12345.zip and writes manifest.json.
 * Run after scrape:zip, or before build. Idempotent: skips already-hashed files.
 */

import { createHash } from 'crypto';
import { readdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.join(__dirname, '..', '..', 'public', 'icons');
const ZIP_CATEGORIES = ['materials', 'alchemy', 'blacksmithing', 'enchanting', 'engineering', 'jewelcrafting', 'leatherworking', 'tailoring'];

async function hashFile(filePath) {
  const buf = await readFile(filePath);
  return createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

async function main() {
  const entries = await readdir(ICONS_DIR, { withFileTypes: true });
  const manifest = {};

  for (const category of ZIP_CATEGORIES) {
    const plainPath = path.join(ICONS_DIR, `${category}.zip`);
    const plainExists = await stat(plainPath).then(() => true).catch(() => false);

    if (plainExists) {
      const hash = await hashFile(plainPath);
      const hashedName = `${category}-${hash}.zip`;
      const hashedPath = path.join(ICONS_DIR, hashedName);
      await rename(plainPath, hashedPath);
      manifest[category] = hashedName;
      console.log(`Hashed ${category}.zip -> ${hashedName}`);
    } else {
      const hashedFiles = entries
        .filter(e => e.isFile() && e.name.startsWith(`${category}-`) && e.name.endsWith('.zip'))
        .map(e => e.name);
      if (hashedFiles.length > 0) {
        manifest[category] = hashedFiles[0];
      }
    }
  }

  const manifestPath = path.join(ICONS_DIR, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${manifestPath}`);

  const keep = new Set(Object.values(manifest));
  const finalEntries = await readdir(ICONS_DIR, { withFileTypes: true });
  const allZips = finalEntries.filter(e => e.isFile() && e.name.endsWith('.zip')).map(e => e.name);
  for (const name of allZips) {
    if (!keep.has(name)) {
      await unlink(path.join(ICONS_DIR, name));
      console.log(`Removed old ${name}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
