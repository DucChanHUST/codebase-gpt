import { execSync } from 'child_process';
import type { ChangeCoupling, CommitRecord } from '../types.js';

// ───────────────────────────────────────────────────────────────────────────
// Git log reader
// ───────────────────────────────────────────────────────────────────────────
export function readGitLog(root: string): CommitRecord[] {
  try {
    const out = execSync(
      'git log --pretty=format:"%H|%aI|%an|%ae|%s" --name-only --diff-filter=ACM',
      { cwd: root, maxBuffer: 50 * 1024 * 1024, encoding: 'utf8' }
    );
    return parseGitLog(out);
  } catch {
    return [];
  }
}

export function parseGitLog(raw: string): CommitRecord[] {
  const records: CommitRecord[] = [];
  const blocks = raw.trim().split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    if (!lines.length) continue;
    const meta = lines[0].split('|');
    if (meta.length < 5) continue;
    const [hash, date, author, email, ...msgParts] = meta;
    const message = msgParts.join('|');
    const files = lines.slice(1).filter(l => !l.startsWith('"') && l.trim().length > 0);
    records.push({ hash, date, author, email, message, files });
  }
  return records;
}

// ───────────────────────────────────────────────────────────────────────────
// Change coupling via Apriori-style co-occurrence
// ───────────────────────────────────────────────────────────────────────────
export function computeChangeCoupling(commits: CommitRecord[], minSupport = 0.3): ChangeCoupling[] {
  const pairCount: Record<string, number> = {};
  const fileCount: Record<string, number> = {};

  for (const commit of commits) {
    const files = [...new Set(commit.files)];
    for (const f of files) {
      fileCount[f] = (fileCount[f] ?? 0) + 1;
    }
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const key = [files[i], files[j]].sort().join('\0');
        pairCount[key] = (pairCount[key] ?? 0) + 1;
      }
    }
  }

  const results: ChangeCoupling[] = [];
  for (const [key, count] of Object.entries(pairCount)) {
    const [fileA, fileB] = key.split('\0');
    const maxOccurrences = Math.max(fileCount[fileA] ?? 1, fileCount[fileB] ?? 1);
    const support = count / maxOccurrences;
    if (support >= minSupport) {
      results.push({ fileA, fileB, coOccurrences: count, support });
    }
  }

  return results.sort((a, b) => b.support - a.support);
}

// ───────────────────────────────────────────────────────────────────────────
// Bus factor
// ───────────────────────────────────────────────────────────────────────────
export interface ContributorStats {
  author: string;
  commits: number;
  fraction: number;
}

export interface BusFactor {
  path: string;
  busFactor: number;
  contributors: ContributorStats[];
  entropy: number;
}

export function computeBusFactor(commits: CommitRecord[], files: string[]): BusFactor[] {
  // Per-file author commit counts
  const fileAuthorMap: Record<string, Record<string, number>> = {};
  for (const commit of commits) {
    for (const f of commit.files) {
      if (!fileAuthorMap[f]) fileAuthorMap[f] = {};
      fileAuthorMap[f][commit.author] = (fileAuthorMap[f][commit.author] ?? 0) + 1;
    }
  }

  const result: BusFactor[] = [];
  for (const filePath of files) {
    const authorMap = fileAuthorMap[filePath] ?? {};
    const total = Object.values(authorMap).reduce((a, b) => a + b, 0);
    if (total === 0) continue;

    const contributors: ContributorStats[] = Object.entries(authorMap)
      .map(([author, commits]) => ({ author, commits, fraction: commits / total }))
      .sort((a, b) => b.fraction - a.fraction);

    // Shannon entropy
    let entropy = 0;
    for (const c of contributors) {
      if (c.fraction > 0) entropy -= c.fraction * Math.log2(c.fraction);
    }

    // Bus factor = # contributors needed to cover 50%+ of commits
    let cumulative = 0;
    let busFactor = 0;
    for (const c of contributors) {
      cumulative += c.fraction;
      busFactor++;
      if (cumulative >= 0.5) break;
    }

    result.push({ path: filePath, busFactor, contributors, entropy });
  }

  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// Expert finder
// ───────────────────────────────────────────────────────────────────────────
export interface ExpertScore {
  author: string;
  email: string;
  score: number;
  commits: number;
  recentCommits: number;
  files: string[];
}

export function findExperts(commits: CommitRecord[], relevantFiles: string[]): ExpertScore[] {
  const fileSet = new Set(relevantFiles);
  const authorMap: Record<string, { commits: CommitRecord[]; files: Set<string> }> = {};
  const now = Date.now();

  for (const commit of commits) {
    const matchedFiles = commit.files.filter(f => fileSet.has(f));
    if (matchedFiles.length === 0) continue;
    if (!authorMap[commit.author]) authorMap[commit.author] = { commits: [], files: new Set() };
    authorMap[commit.author].commits.push(commit);
    matchedFiles.forEach(f => authorMap[commit.author].files.add(f));
  }

  const experts: ExpertScore[] = [];
  for (const [author, data] of Object.entries(authorMap)) {
    const email = data.commits[0]?.email ?? '';
    const totalCommits = data.commits.length;
    // Recency: commits in last 90 days get 2x weight
    const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;
    const recentCommits = data.commits.filter(c => new Date(c.date).getTime() > ninetyDaysAgo).length;
    const scope = data.files.size;
    const score = (recentCommits * 2 + (totalCommits - recentCommits)) * Math.log1p(scope);
    experts.push({ author, email, score, commits: totalCommits, recentCommits, files: [...data.files] });
  }

  return experts.sort((a, b) => b.score - a.score);
}
