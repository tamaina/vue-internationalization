import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const source = resolve('docs/vitepress.config.ts');
const target = resolve('docs/.vitepress/config.ts');

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
