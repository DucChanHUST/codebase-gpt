import * as path from 'path';
import type { CodeEdge, CodeEntity, FileInfo, KnowledgeGraph } from '../types.js';

export class Graph {
  kg: KnowledgeGraph;

  constructor(root: string) {
    this.kg = {
      version: '1',
      root,
      indexedAt: new Date().toISOString(),
      files: {},
      entities: {},
      edges: [],
      changeCoupling: [],
      summaries: {},
      pageRank: {},
    };
  }

  addFile(info: FileInfo): void {
    this.kg.files[info.path] = info;
    for (const entity of info.entities) {
      this.kg.entities[entity.id] = entity;
    }
  }

  buildEdges(): void {
    const edges: CodeEdge[] = [];
    const filesByPath = this.kg.files;

    for (const [filePath, fileInfo] of Object.entries(filesByPath)) {
      // Import edges
      for (const imp of fileInfo.imports) {
        const resolved = resolveImport(imp, filePath, Object.keys(filesByPath));
        if (resolved) {
          edges.push({ from: filePath, to: resolved, kind: 'imports' });
        }
      }
    }

    this.kg.edges = edges;
  }

  buildSummaries(): void {
    for (const [filePath, fileInfo] of Object.entries(this.kg.files)) {
      const funcs = fileInfo.entities.filter(e => e.kind === 'function' || e.kind === 'method');
      const classes = fileInfo.entities.filter(e => e.kind === 'class');
      const interfaces = fileInfo.entities.filter(e => e.kind === 'interface');
      const parts: string[] = [];
      if (classes.length) parts.push(`Classes: ${classes.map(c => c.name).join(', ')}`);
      if (interfaces.length) parts.push(`Interfaces: ${interfaces.map(i => i.name).join(', ')}`);
      if (funcs.length) parts.push(`Functions: ${funcs.map(f => f.name).join(', ')}`);
      if (fileInfo.exports.length) parts.push(`Exports: ${fileInfo.exports.slice(0, 10).join(', ')}`);
      this.kg.summaries[filePath] = parts.join('. ') || 'No top-level entities found.';
    }

    // Entity summaries
    for (const [id, entity] of Object.entries(this.kg.entities)) {
      const parts: string[] = [`${entity.kind} ${entity.name}`];
      if (entity.params?.length) parts.push(`(${entity.params.join(', ')})`);
      if (entity.returnType) parts.push(`→ ${entity.returnType}`);
      if (entity.comment) parts.push(`// ${entity.comment}`);
      this.kg.summaries[id] = parts.join(' ');
    }
  }

  computePageRank(iterations = 20, dampingFactor = 0.85): void {
    const files = Object.keys(this.kg.files);
    const n = files.length;
    if (n === 0) return;

    const ranks: Record<string, number> = {};
    for (const f of files) ranks[f] = 1 / n;

    // Build adjacency (incoming links)
    const inLinks: Record<string, string[]> = {};
    for (const f of files) inLinks[f] = [];
    for (const edge of this.kg.edges) {
      if (edge.kind === 'imports' && inLinks[edge.to] !== undefined) {
        inLinks[edge.to].push(edge.from);
      }
    }

    // Out-degree
    const outDegree: Record<string, number> = {};
    for (const f of files) {
      outDegree[f] = this.kg.edges.filter(e => e.from === f && e.kind === 'imports').length;
    }

    for (let i = 0; i < iterations; i++) {
      const newRanks: Record<string, number> = {};
      for (const f of files) {
        let rank = (1 - dampingFactor) / n;
        for (const src of inLinks[f]) {
          rank += dampingFactor * (ranks[src] / Math.max(outDegree[src], 1));
        }
        newRanks[f] = rank;
      }
      Object.assign(ranks, newRanks);
    }

    this.kg.pageRank = ranks;
  }

  toJSON(): KnowledgeGraph {
    return this.kg;
  }

  static fromJSON(data: KnowledgeGraph): Graph {
    const g = new Graph(data.root);
    g.kg = data;
    return g;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Import resolver
// ───────────────────────────────────────────────────────────────────────────
function resolveImport(importPath: string, fromFile: string, allFiles: string[]): string | null {
  if (!importPath.startsWith('.')) return null; // skip node_modules
  const dir = path.dirname(fromFile);
  const base = path.resolve(dir, importPath);
  const candidates = [
    base,
    base + '.ts', base + '.tsx', base + '.js', base + '.jsx',
    base + '/index.ts', base + '/index.js',
  ];
  for (const c of candidates) {
    if (allFiles.includes(c)) return c;
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Community detection — Louvain (simplified greedy)
// ───────────────────────────────────────────────────────────────────────────
export function detectCommunities(kg: KnowledgeGraph): Record<string, number> {
  const files = Object.keys(kg.files);
  const community: Record<string, number> = {};
  files.forEach((f, i) => { community[f] = i; });

  const neighbors: Record<string, Set<string>> = {};
  for (const f of files) neighbors[f] = new Set();
  for (const edge of kg.edges) {
    if (edge.kind === 'imports') {
      neighbors[edge.from]?.add(edge.to);
      neighbors[edge.to]?.add(edge.from);
    }
  }

  // Greedy: merge nodes with most common neighbor communities
  let changed = true;
  let passes = 0;
  while (changed && passes < 10) {
    changed = false;
    passes++;
    for (const f of files) {
      const neighborCommunities: Record<number, number> = {};
      for (const nb of neighbors[f]) {
        const c = community[nb];
        neighborCommunities[c] = (neighborCommunities[c] ?? 0) + 1;
      }
      let bestComm = community[f];
      let bestCount = 0;
      for (const [c, cnt] of Object.entries(neighborCommunities)) {
        if (cnt > bestCount) { bestCount = cnt; bestComm = Number(c); }
      }
      if (bestComm !== community[f]) {
        community[f] = bestComm;
        changed = true;
      }
    }
  }

  // Normalize community ids
  const idMap: Record<number, number> = {};
  let nextId = 0;
  for (const f of files) {
    if (idMap[community[f]] === undefined) idMap[community[f]] = nextId++;
    community[f] = idMap[community[f]];
  }

  return community;
}
