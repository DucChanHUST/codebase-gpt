import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { CodeEntity, FileInfo } from '../types.js';

// ───────────────────────────────────────────────────────────────────────────
// Language detection
// ───────────────────────────────────────────────────────────────────────────
export function detectLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
  };
  return map[ext] ?? null;
}

// ───────────────────────────────────────────────────────────────────────────
// File hash
// ───────────────────────────────────────────────────────────────────────────
export function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ───────────────────────────────────────────────────────────────────────────
// TypeScript / JavaScript parser
// ───────────────────────────────────────────────────────────────────────────
function parseTypeScript(filePath: string, source: string): Partial<FileInfo> {
  const entities: CodeEntity[] = [];
  const imports: string[] = [];
  const exports: string[] = [];
  const lines = source.split('\n');

  // Leading JSDoc comment extractor
  function precedingComment(lineIdx: number): string | undefined {
    const commentLines: string[] = [];
    let i = lineIdx - 1;
    while (i >= 0 && /^\s*(\*|\/\*|\*\/)/.test(lines[i])) {
      commentLines.unshift(lines[i].trim().replace(/^[/*\s]+/, '').replace(/[/*\s]+$/, ''));
      i--;
    }
    return commentLines.length ? commentLines.join(' ') : undefined;
  }

  // Imports
  const importRe = /^import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/;
  const requireRe = /require\(['"]([^'"]+)['"]\)/g;

  lines.forEach((line) => {
    const m = importRe.exec(line);
    if (m) imports.push(m[1]);
    let rm: RegExpExecArray | null;
    while ((rm = requireRe.exec(line)) !== null) imports.push(rm[1]);
  });

  // Functions
  const fnRe = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^\s{]+))?/;
  const arrowRe = /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*([^\s=]+))?\s*=>/;
  const classRe = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/;
  const interfaceRe = /^(?:export\s+)?interface\s+(\w+)/;
  const typeRe = /^(?:export\s+)?type\s+(\w+)\s*=/;
  const methodRe = /^\s+(?:async\s+)?(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^\s{]+))?\s*\{/;
  const exportRe = /^export\s+(?:default\s+)?(?:const|let|var|class|function|interface|type)\s+(\w+)/;
  const exportNamedRe = /^export\s*\{([^}]+)\}/;

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    let m: RegExpExecArray | null;

    if ((m = fnRe.exec(line.trim()))) {
      const exported = /^export/.test(line.trim());
      const id = `${filePath}:${lineNo}:${m[1]}`;
      entities.push({ id, name: m[1], kind: 'function', file: filePath, line: lineNo, exported, comment: precedingComment(idx), params: m[2] ? m[2].split(',').map(p => p.trim()).filter(Boolean) : [], returnType: m[3] });
      if (exported) exports.push(m[1]);
    } else if ((m = arrowRe.exec(line.trim()))) {
      const exported = /^export/.test(line.trim());
      const id = `${filePath}:${lineNo}:${m[1]}`;
      entities.push({ id, name: m[1], kind: 'function', file: filePath, line: lineNo, exported, params: m[2] ? m[2].split(',').map(p => p.trim()).filter(Boolean) : [], returnType: m[3] });
      if (exported) exports.push(m[1]);
    } else if ((m = classRe.exec(line.trim()))) {
      const exported = /^export/.test(line.trim());
      const id = `${filePath}:${lineNo}:${m[1]}`;
      entities.push({ id, name: m[1], kind: 'class', file: filePath, line: lineNo, exported, comment: precedingComment(idx) });
      if (exported) exports.push(m[1]);
    } else if ((m = interfaceRe.exec(line.trim()))) {
      const exported = /^export/.test(line.trim());
      const id = `${filePath}:${lineNo}:${m[1]}`;
      entities.push({ id, name: m[1], kind: 'interface', file: filePath, line: lineNo, exported });
      if (exported) exports.push(m[1]);
    } else if ((m = typeRe.exec(line.trim()))) {
      const exported = /^export/.test(line.trim());
      const id = `${filePath}:${lineNo}:${m[1]}`;
      entities.push({ id, name: m[1], kind: 'type', file: filePath, line: lineNo, exported });
      if (exported) exports.push(m[1]);
    } else if ((m = methodRe.exec(line)) && !line.trimStart().startsWith('//')) {
      const id = `${filePath}:${lineNo}:${m[1]}`;
      entities.push({ id, name: m[1], kind: 'method', file: filePath, line: lineNo, exported: false, params: m[2] ? m[2].split(',').map(p => p.trim()).filter(Boolean) : [], returnType: m[3] });
    }

    if ((m = exportRe.exec(line.trim()))) exports.push(m[1]);
    if ((m = exportNamedRe.exec(line.trim()))) {
      m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean).forEach(n => exports.push(n));
    }
  });

  return { entities, imports, exports: [...new Set(exports)] };
}

// ───────────────────────────────────────────────────────────────────────────
// Python parser
// ───────────────────────────────────────────────────────────────────────────
function parsePython(filePath: string, source: string): Partial<FileInfo> {
  const entities: CodeEntity[] = [];
  const imports: string[] = [];
  const exports: string[] = [];
  const lines = source.split('\n');

  const fnRe = /^(\s*)def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^\s:]+))?:/;
  const classRe = /^class\s+(\w+)(?:\(([^)]+)\))?:/;
  const importRe = /^import\s+([\w.,\s]+)/;
  const fromImportRe = /^from\s+([\w.]+)\s+import\s+([\w,\s*]+)/;

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    let m: RegExpExecArray | null;

    if ((m = fnRe.exec(line))) {
      const indent = m[1].length;
      const name = m[2];
      const exported = !name.startsWith('_');
      const id = `${filePath}:${lineNo}:${name}`;
      entities.push({ id, name, kind: indent === 0 ? 'function' : 'method', file: filePath, line: lineNo, exported, params: m[3] ? m[3].split(',').map(p => p.trim().split(':')[0].trim()).filter(Boolean) : [], returnType: m[4] });
      if (exported && indent === 0) exports.push(name);
    } else if ((m = classRe.exec(line))) {
      const id = `${filePath}:${lineNo}:${m[1]}`;
      entities.push({ id, name: m[1], kind: 'class', file: filePath, line: lineNo, exported: !m[1].startsWith('_') });
      if (!m[1].startsWith('_')) exports.push(m[1]);
    }

    if ((m = importRe.exec(line.trim()))) {
      m[1].split(',').map(s => s.trim()).forEach(s => imports.push(s));
    }
    if ((m = fromImportRe.exec(line.trim()))) {
      imports.push(m[1]);
    }
  });

  return { entities, imports, exports: [...new Set(exports)] };
}

// ───────────────────────────────────────────────────────────────────────────
// Generic stub parsers (Go, Rust, Java)
// ───────────────────────────────────────────────────────────────────────────
function parseGo(filePath: string, source: string): Partial<FileInfo> {
  const entities: CodeEntity[] = [];
  const imports: string[] = [];
  const exports: string[] = [];
  const lines = source.split('\n');
  const fnRe = /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/;
  const structRe = /^type\s+(\w+)\s+struct/;
  const interfaceRe = /^type\s+(\w+)\s+interface/;
  const importRe = /"([^"]+)"/g;

  lines.forEach((line, idx) => {
    let m: RegExpExecArray | null;
    if ((m = fnRe.exec(line))) {
      const id = `${filePath}:${idx + 1}:${m[1]}`;
      entities.push({ id, name: m[1], kind: 'function', file: filePath, line: idx + 1, exported: m[1][0] === m[1][0].toUpperCase() && /[A-Z]/.test(m[1][0]) });
      if (/[A-Z]/.test(m[1][0])) exports.push(m[1]);
    } else if ((m = structRe.exec(line))) {
      const id = `${filePath}:${idx + 1}:${m[1]}`;
      entities.push({ id, name: m[1], kind: 'class', file: filePath, line: idx + 1, exported: /[A-Z]/.test(m[1][0]) });
    } else if ((m = interfaceRe.exec(line))) {
      const id = `${filePath}:${idx + 1}:${m[1]}`;
      entities.push({ id, name: m[1], kind: 'interface', file: filePath, line: idx + 1, exported: /[A-Z]/.test(m[1][0]) });
    }
    let im: RegExpExecArray | null;
    while ((im = importRe.exec(line)) !== null) imports.push(im[1]);
  });
  return { entities, imports, exports };
}

function parseRust(filePath: string, source: string): Partial<FileInfo> {
  const entities: CodeEntity[] = [];
  const imports: string[] = [];
  const exports: string[] = [];
  const lines = source.split('\n');
  const fnRe = /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/;
  const structRe = /^(?:pub\s+)?struct\s+(\w+)/;
  const traitRe = /^(?:pub\s+)?trait\s+(\w+)/;
  const useRe = /^use\s+([\w:]+)/;

  lines.forEach((line, idx) => {
    let m: RegExpExecArray | null;
    if ((m = fnRe.exec(line.trim()))) {
      const exported = line.trim().startsWith('pub ');
      const id = `${filePath}:${idx + 1}:${m[1]}`;
      entities.push({ id, name: m[1], kind: 'function', file: filePath, line: idx + 1, exported });
      if (exported) exports.push(m[1]);
    } else if ((m = structRe.exec(line.trim()))) {
      const exported = line.trim().startsWith('pub ');
      const id = `${filePath}:${idx + 1}:${m[1]}`;
      entities.push({ id, name: m[1], kind: 'class', file: filePath, line: idx + 1, exported });
    } else if ((m = traitRe.exec(line.trim()))) {
      const id = `${filePath}:${idx + 1}:${m[1]}`;
      entities.push({ id, name: m[1], kind: 'interface', file: filePath, line: idx + 1, exported: line.trim().startsWith('pub ') });
    }
    if ((m = useRe.exec(line.trim()))) imports.push(m[1]);
  });
  return { entities, imports, exports };
}

function parseJava(filePath: string, source: string): Partial<FileInfo> {
  const entities: CodeEntity[] = [];
  const imports: string[] = [];
  const exports: string[] = [];
  const lines = source.split('\n');
  const classRe = /^(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/;
  const interfaceRe = /^(?:public\s+)?interface\s+(\w+)/;
  const methodRe = /^\s+(?:public|private|protected)\s+(?:static\s+)?(?:\w+)\s+(\w+)\s*\(/;
  const importRe = /^import\s+([\w.]+);/;

  lines.forEach((line, idx) => {
    let m: RegExpExecArray | null;
    if ((m = classRe.exec(line.trim()))) {
      const id = `${filePath}:${idx + 1}:${m[1]}`;
      entities.push({ id, name: m[1], kind: 'class', file: filePath, line: idx + 1, exported: true });
      exports.push(m[1]);
    } else if ((m = interfaceRe.exec(line.trim()))) {
      const id = `${filePath}:${idx + 1}:${m[1]}`;
      entities.push({ id, name: m[1], kind: 'interface', file: filePath, line: idx + 1, exported: true });
    } else if ((m = methodRe.exec(line))) {
      const id = `${filePath}:${idx + 1}:${m[1]}`;
      entities.push({ id, name: m[1], kind: 'method', file: filePath, line: idx + 1, exported: /public/.test(line) });
    }
    if ((m = importRe.exec(line.trim()))) imports.push(m[1]);
  });
  return { entities, imports, exports };
}

// ───────────────────────────────────────────────────────────────────────────
// Main parse entry point
// ───────────────────────────────────────────────────────────────────────────
export function parseSource(
  filePath: string,
  source: string,
  metadata: Pick<fs.Stats, 'size' | 'mtimeMs'>,
  contentHash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16),
): FileInfo | null {
  const lang = detectLanguage(filePath);
  if (!lang) return null;

  let partial: Partial<FileInfo> = {};
  switch (lang) {
    case 'typescript':
    case 'javascript':
      partial = parseTypeScript(filePath, source);
      break;
    case 'python':
      partial = parsePython(filePath, source);
      break;
    case 'go':
      partial = parseGo(filePath, source);
      break;
    case 'rust':
      partial = parseRust(filePath, source);
      break;
    case 'java':
      partial = parseJava(filePath, source);
      break;
  }

  return {
    path: filePath,
    hash: contentHash,
    language: lang,
    entities: partial.entities ?? [],
    imports: partial.imports ?? [],
    exports: partial.exports ?? [],
    size: metadata.size,
    lastModified: metadata.mtimeMs,
  };
}

export function parseFile(filePath: string): FileInfo | null {
  if (!detectLanguage(filePath)) return null;
  let content: Buffer;
  try {
    content = fs.readFileSync(filePath);
  } catch {
    return null;
  }
  const stat = fs.statSync(filePath);
  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  return parseSource(filePath, content.toString('utf8'), stat, hash);
}
