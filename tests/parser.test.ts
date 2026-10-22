import { describe, it, expect } from 'vitest';
import { parseFile } from '../src/parser/index.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsFixture = path.join(__dirname, 'fixtures/ts-project/src');
const pyFixture = path.join(__dirname, 'fixtures/py-project');

describe('TypeScript parser', () => {
  it('extracts functions', () => {
    const info = parseFile(path.join(tsFixture, 'utils.ts'));
    expect(info).not.toBeNull();
    const names = info!.entities.map(e => e.name);
    expect(names).toContain('add');
    expect(names).toContain('multiply');
    expect(names).toContain('greet');
  });

  it('marks exported entities', () => {
    const info = parseFile(path.join(tsFixture, 'utils.ts'));
    const add = info!.entities.find(e => e.name === 'add');
    expect(add?.exported).toBe(true);
  });

  it('extracts classes and interfaces', () => {
    const info = parseFile(path.join(tsFixture, 'service.ts'));
    expect(info).not.toBeNull();
    const kinds = info!.entities.map(e => e.kind);
    expect(kinds).toContain('class');
    expect(kinds).toContain('interface');
  });

  it('extracts imports', () => {
    const info = parseFile(path.join(tsFixture, 'service.ts'));
    expect(info!.imports.length).toBeGreaterThan(0);
  });

  it('captures JSDoc comment', () => {
    const info = parseFile(path.join(tsFixture, 'utils.ts'));
    const greet = info!.entities.find(e => e.name === 'greet');
    expect(greet?.comment).toContain('Greet');
  });
});

describe('Python parser', () => {
  it('extracts functions and classes', () => {
    const info = parseFile(path.join(pyFixture, 'main.py'));
    expect(info).not.toBeNull();
    const names = info!.entities.map(e => e.name);
    expect(names).toContain('add');
    expect(names).toContain('greet');
    expect(names).toContain('Calculator');
  });

  it('marks private functions as non-exported', () => {
    const info = parseFile(path.join(pyFixture, 'main.py'));
    const priv = info!.entities.find(e => e.name === '_private_helper');
    expect(priv?.exported).toBe(false);
  });

  it('extracts method kinds inside class', () => {
    const info = parseFile(path.join(pyFixture, 'main.py'));
    const compute = info!.entities.find(e => e.name === 'compute');
    expect(compute?.kind).toBe('method');
  });
});
