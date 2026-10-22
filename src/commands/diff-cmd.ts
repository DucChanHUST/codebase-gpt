import chalk from 'chalk';
import { execSync } from 'child_process';
import { loadIndex } from '../utils/index.js';
import * as path from 'path';

interface DiffEntry {
  hash: string;
  date: string;
  author: string;
  message: string;
  files: string[];
}

export async function diffCommand(root: string, options: { since?: string }): Promise<void> {
  const kg = loadIndex(root);
  if (!kg) {
    console.error(chalk.red('No index found. Run `codebase-gpt index` first.'));
    process.exit(1);
  }

  const since = options.since ?? 'HEAD~10';

  let gitLog: string;
  try {
    gitLog = execSync(
      `git log ${since}..HEAD --pretty=format:"%H|%aI|%an|%s" --name-only --diff-filter=ACM`,
      { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
  } catch {
    console.error(chalk.red('Failed to get git log. Is this a git repository?'));
    process.exit(1);
  }

  if (!gitLog.trim()) {
    console.log(chalk.yellow(`No changes since ${since}`));
    return;
  }

  const commits = parseLogForDiff(gitLog);
  console.log(chalk.cyan(`\n📋 Changes since ${since} (${commits.length} commits)\n`));

  // Group changes by directory/feature
  const dirGroups: Record<string, DiffEntry[]> = {};
  for (const commit of commits) {
    const dirs = [...new Set(commit.files.map(f => path.dirname(f).split(path.sep)[0] || '.'))];
    const key = dirs.sort().join(', ');
    if (!dirGroups[key]) dirGroups[key] = [];
    dirGroups[key].push(commit);
  }

  for (const [area, areaCommits] of Object.entries(dirGroups)) {
    console.log(chalk.bold(`📁 ${area}:`));
    for (const commit of areaCommits) {
      const date = new Date(commit.date).toLocaleDateString();
      console.log(`  ${chalk.gray(commit.hash.slice(0, 7))} ${chalk.white(commit.message)} ${chalk.dim(`— ${commit.author}, ${date}`)}`);
      for (const f of commit.files.slice(0, 5)) {
        console.log(`    ${chalk.gray('+')} ${f}`);
      }
      if (commit.files.length > 5) console.log(`    ${chalk.dim(`... and ${commit.files.length - 5} more files`)}`);
    }
    console.log();
  }

  // Check for PR/issue references
  const prRefs = commits.flatMap(c => {
    const matches = c.message.match(/#(\d+)/g) ?? [];
    return matches.map(m => ({ pr: m, commit: c.hash.slice(0, 7), msg: c.message }));
  });

  if (prRefs.length > 0) {
    console.log(chalk.bold('🔗 PR/Issue References:'));
    for (const ref of prRefs) {
      console.log(`  ${chalk.cyan(ref.pr)} in ${ref.commit}: ${ref.msg}`);
    }
    console.log();
  }

  // Coupling-aware summary
  const changedFiles = new Set(commits.flatMap(c => c.files));
  const relatedNotChanged = kg.changeCoupling
    .filter(c => (changedFiles.has(c.fileA) && !changedFiles.has(c.fileB)) || (changedFiles.has(c.fileB) && !changedFiles.has(c.fileA)))
    .slice(0, 5);

  if (relatedNotChanged.length > 0) {
    console.log(chalk.bold('⚠️  Coupled files NOT changed (consider checking):'));
    for (const c of relatedNotChanged) {
      const unchanged = changedFiles.has(c.fileA) ? c.fileB : c.fileA;
      console.log(`  ${chalk.yellow(path.relative(root, unchanged))} (usually changes with modified files, ${Math.round(c.support * 100)}% coupling)`);
    }
  }
}

function parseLogForDiff(raw: string): DiffEntry[] {
  const records: DiffEntry[] = [];
  const blocks = raw.trim().split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    if (!lines.length) continue;
    const meta = lines[0].split('|');
    if (meta.length < 4) continue;
    const [hash, date, author, ...msgParts] = meta;
    records.push({ hash, date, author, message: msgParts.join('|'), files: lines.slice(1) });
  }
  return records;
}
