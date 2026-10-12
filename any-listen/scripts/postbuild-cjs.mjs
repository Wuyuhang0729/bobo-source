// The root package.json declares "type": "module", so the CommonJS build needs
// its own package.json to be interpreted as CJS by Node.
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cjsDir = path.join(root, 'dist', 'cjs');

await mkdir(cjsDir, { recursive: true });
await writeFile(
  path.join(cjsDir, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
  'utf8',
);

console.log('postbuild-cjs: wrote dist/cjs/package.json ({"type":"commonjs"})');
