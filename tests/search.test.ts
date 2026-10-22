import { describe, it, expect } from 'vitest';
import { buildSearchIndex, search } from '../src/algorithms/search.js';
import type { KnowledgeGraph } from '../src/types.js';

const mockKG: KnowledgeGraph = {
  version: '1',
  root: '/test',
  indexedAt: new Date().toISOString(),
  files: {
    '/test/auth.ts': {
      path: '/test/auth.ts',
      hash: 'abc',
      language: 'typescript',
      entities: [],
      imports: [],
      exports: ['authenticate', 'AuthService'],
      size: 1000,
      lastModified: Date.now(),
    },
    '/test/utils.ts': {
      path: '/test/utils.ts',
      hash: 'def',
      language: 'typescript',
      entities: [],
      imports: [],
      exports: ['formatDate', 'parseToken'],
      size: 500,
      lastModified: Date.now(),
    },
  },
  entities: {
    '/test/auth.ts:5:authenticate': {
      id: '/test/auth.ts:5:authenticate',
      name: 'authenticate',
      kind: 'function',
      file: '/test/auth.ts',
      line: 5,
      exported: true,
      comment: 'Validates JWT token and returns user',
    },
    '/test/auth.ts:20:AuthService': {
      id: '/test/auth.ts:20:AuthService',
      name: 'AuthService',
      kind: 'class',
      file: '/test/auth.ts',
      line: 20,
      exported: true,
    },
    '/test/utils.ts:3:formatDate': {
      id: '/test/utils.ts:3:formatDate',
      name: 'formatDate',
      kind: 'function',
      file: '/test/utils.ts',
      line: 3,
      exported: true,
    },
  },
  edges: [],
  changeCoupling: [],
  summaries: {
    '/test/auth.ts': 'Classes: AuthService. Functions: authenticate. Exports: authenticate, AuthService',
    '/test/utils.ts': 'Functions: formatDate, parseToken. Exports: formatDate, parseToken',
  },
  pageRank: {},
};

describe('Search algorithms', () => {
  it('finds entities by name', () => {
    const docs = buildSearchIndex(mockKG);
    const results = search('authenticate', docs);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('authenticate');
  });

  it('finds by keyword in comment', () => {
    const docs = buildSearchIndex(mockKG);
    const results = search('JWT token', docs);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.file === '/test/auth.ts')).toBe(true);
  });

  it('ranks more relevant results higher', () => {
    const docs = buildSearchIndex(mockKG);
    const results = search('auth service', docs);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toBe('/test/auth.ts');
  });

  it('returns empty for unrelated query', () => {
    const docs = buildSearchIndex(mockKG);
    const results = search('xyzabc123notfound', docs);
    expect(results.length).toBe(0);
  });
});
