import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const DEFAULT_IGNORES = new Set(['.git', 'node_modules', 'dist', '.vite']);

export function scanVueFiles(root: string): string[] {
  const files: string[] = [];

  visit(root, files);

  return files.sort();
}

export function readTextFile(path: string): string {
  return readFileSync(path, 'utf8');
}

function visit(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (DEFAULT_IGNORES.has(entry)) {
      continue;
    }

    const path = join(dir, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      visit(path, files);
      continue;
    }

    if (stat.isFile() && extname(path) === '.vue') {
      files.push(path);
    }
  }
}
