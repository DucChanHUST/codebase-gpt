import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import type { KnowledgeGraph } from '../types.js';

export const INDEX_DIR = '.codebase-gpt';
export const INDEX_FILE = 'index.json';

export function getIndexPath(root: string): string {
  return path.join(root, INDEX_DIR, INDEX_FILE);
}

export function loadIndex(root: string): KnowledgeGraph | null {
  const indexPath = getIndexPath(root);
  if (!fs.existsSync(indexPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf8')) as KnowledgeGraph;
  } catch {
    return null;
  }
}

export function saveIndex(root: string, kg: KnowledgeGraph): void {
  const dir = path.join(root, INDEX_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, INDEX_FILE), JSON.stringify(kg, null, 2));
}

export async function collectFiles(root: string): Promise<string[]> {
  const patterns = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.py', '**/*.go', '**/*.rs', '**/*.java'];
  const ignore = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.codebase-gpt/**', '**/build/**', '**/__pycache__/**', '**/target/**', '**/vendor/**'];

  const files: string[] = [];
  for (const pattern of patterns) {
    const matches = await glob(pattern, { cwd: root, absolute: true, ignore });
    files.push(...matches);
  }
  return [...new Set(files)];
}

export function relPath(root: string, filePath: string): string {
  return path.relative(root, filePath);
}

export function findRoot(startDir: string): string {
  // Walk up to find git root or package.json
  let dir = startDir;
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json')) || fs.existsSync(path.join(dir, 'pyproject.toml'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}
