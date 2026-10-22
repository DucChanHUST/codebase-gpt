import { describe, it, expect } from 'vitest';
import { Graph } from '../src/graph/index.js';
import { parseFile } from '../src/parser/index.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsFixture = path.join(__dirname, 'fixtures/ts-project/src');

describe('Graph construction', () => {
  it('builds file nodes', () => {
    const g = new Graph('/tmp/test');
    const info = parseFile(path.join(tsFixture, 'utils.ts'));
    if (info) g.addFile(info);
    expect(Object.keys(g.kg.files).length).toBe(1);
  });

  it('builds entity nodes', () => {
    const g = new Graph('/tmp/test');
    const info = parseFile(path.join(tsFixture, 'utils.ts'));
    if (info) g.addFile(info);
    expect(Object.keys(g.kg.entities).length).toBeGreaterThan(0);
  });

  it('generates summaries', () => {
    const g = new Graph('/tmp/test');
    const info = parseFile(path.join(tsFixture, 'utils.ts'));
    if (info) g.addFile(info);
    g.buildSummaries();
    const summary = g.kg.summaries[Object.keys(g.kg.files)[0]];
    expect(summary).toBeDefined();
    expect(summary.length).toBeGreaterThan(0);
  });

  it('computes pageRank', () => {
    const g = new Graph('/tmp/test');
    const infoA = parseFile(path.join(tsFixture, 'utils.ts'));
    const infoB = parseFile(path.join(tsFixture, 'service.ts'));
    if (infoA) g.addFile(infoA);
    if (infoB) g.addFile(infoB);
    g.buildEdges();
    g.computePageRank();
    const ranks = Object.values(g.kg.pageRank);
    expect(ranks.length).toBeGreaterThan(0);
    expect(ranks.every(r => r > 0)).toBe(true);
  });
});
