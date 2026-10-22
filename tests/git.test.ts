import { describe, it, expect } from 'vitest';
import { parseGitLog, computeChangeCoupling } from '../src/algorithms/git.js';

const sampleLog = `abc123|2024-01-01T10:00:00Z|Alice|alice@example.com|feat: add user service
src/service.ts
src/utils.ts

def456|2024-01-02T10:00:00Z|Bob|bob@example.com|fix: utils bug
src/utils.ts
src/helper.ts

ghi789|2024-01-03T10:00:00Z|Alice|alice@example.com|refactor: service
src/service.ts
src/utils.ts`;

describe('Git algorithms', () => {
  it('parses git log', () => {
    const commits = parseGitLog(sampleLog);
    expect(commits.length).toBe(3);
    expect(commits[0].author).toBe('Alice');
    expect(commits[0].files).toContain('src/service.ts');
  });

  it('computes change coupling', () => {
    const commits = parseGitLog(sampleLog);
    const coupling = computeChangeCoupling(commits, 0.3);
    expect(coupling.length).toBeGreaterThan(0);
    // service.ts and utils.ts appear together in 2/3 commits
    const pair = coupling.find(c =>
      (c.fileA === 'src/service.ts' && c.fileB === 'src/utils.ts') ||
      (c.fileB === 'src/service.ts' && c.fileA === 'src/utils.ts')
    );
    expect(pair).toBeDefined();
    expect(pair!.coOccurrences).toBe(2);
  });

  it('returns empty coupling for single-file commits', () => {
    const singleFileLog = `abc|2024-01-01T00:00:00Z|Alice|a@b.com|feat\nsrc/a.ts\n\ndef|2024-01-02T00:00:00Z|Bob|b@b.com|fix\nsrc/b.ts`;
    const commits = parseGitLog(singleFileLog);
    const coupling = computeChangeCoupling(commits, 0.3);
    expect(coupling.length).toBe(0);
  });
});
