import type { KnowledgeGraph } from '../types.js';

// ───────────────────────────────────────────────────────────────────────────
// TF-IDF text search over entity names + comments
// ───────────────────────────────────────────────────────────────────────────
interface SearchDoc {
  id: string;
  type: 'entity' | 'file';
  text: string;
  file: string;
  line?: number;
}

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[_\-./\\]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

export interface SearchResult {
  id: string;
  type: 'entity' | 'file';
  score: number;
  name: string;
  file: string;
  line?: number;
  snippet?: string;
}

export function buildSearchIndex(kg: KnowledgeGraph): SearchDoc[] {
  const docs: SearchDoc[] = [];

  for (const [id, entity] of Object.entries(kg.entities)) {
    const text = [entity.name, entity.comment ?? '', entity.kind, ...(entity.params ?? [])].join(' ');
    docs.push({ id, type: 'entity', text, file: entity.file, line: entity.line });
  }

  for (const [filePath, fileInfo] of Object.entries(kg.files)) {
    const summary = kg.summaries[filePath] ?? '';
    docs.push({ id: filePath, type: 'file', text: `${filePath} ${summary}`, file: filePath });
  }

  return docs;
}

export function search(query: string, docs: SearchDoc[], topK = 10): SearchResult[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  // TF-IDF
  const docTokens = docs.map(d => tokenize(d.text));

  // DF
  const df: Record<string, number> = {};
  for (const tokens of docTokens) {
    const seen = new Set(tokens);
    for (const t of seen) df[t] = (df[t] ?? 0) + 1;
  }
  const N = docs.length;

  const scores: { doc: SearchDoc; score: number }[] = docs.map((doc, i) => {
    const tokens = docTokens[i];
    const tf: Record<string, number> = {};
    for (const t of tokens) tf[t] = (tf[t] ?? 0) + 1;

    let score = 0;
    for (const qt of queryTokens) {
      const tfVal = (tf[qt] ?? 0) / Math.max(tokens.length, 1);
      const idf = Math.log((N + 1) / ((df[qt] ?? 0) + 1)) + 1;
      score += tfVal * idf;
    }

    // Boost entities with exact name match
    if (doc.type === 'entity') {
      const name = doc.text.split(' ')[0].toLowerCase();
      if (queryTokens.some(qt => name.includes(qt))) score *= 2;
    }

    return { doc, score };
  });

  return scores
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => ({
      id: s.doc.id,
      type: s.doc.type,
      score: s.score,
      name: s.doc.id.split(':').pop() ?? s.doc.id,
      file: s.doc.file,
      line: s.doc.line,
      snippet: s.doc.text.slice(0, 120),
    }));
}

// ───────────────────────────────────────────────────────────────────────────
// Graph traversal from search results — expand via imports/calls
// ───────────────────────────────────────────────────────────────────────────
export function expandContext(ids: string[], kg: KnowledgeGraph, hops = 1): Set<string> {
  const visited = new Set<string>(ids);
  let frontier = new Set<string>(ids);

  for (let i = 0; i < hops; i++) {
    const next = new Set<string>();
    for (const edge of kg.edges) {
      if (frontier.has(edge.from) && !visited.has(edge.to)) {
        next.add(edge.to);
        visited.add(edge.to);
      }
      if (frontier.has(edge.to) && !visited.has(edge.from)) {
        next.add(edge.from);
        visited.add(edge.from);
      }
    }
    frontier = next;
  }

  return visited;
}
