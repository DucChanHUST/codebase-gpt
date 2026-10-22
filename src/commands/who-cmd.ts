import chalk from 'chalk';
import { loadIndex } from '../utils/index.js';
import { buildSearchIndex, search } from '../algorithms/search.js';
import { readGitLog, findExperts } from '../algorithms/git.js';
import * as path from 'path';

export async function whoCommand(root: string, topic: string): Promise<void> {
  const kg = loadIndex(root);
  if (!kg) {
    console.error(chalk.red('No index found. Run `codebase-gpt index` first.'));
    process.exit(1);
  }

  console.log(chalk.cyan(`\n👥 Who knows about "${topic}"?\n`));

  // Find relevant files
  const docs = buildSearchIndex(kg);
  const results = search(topic, docs, 20);
  const relevantFiles = [...new Set(results.map(r => r.file))];

  if (relevantFiles.length === 0) {
    console.log(chalk.yellow('No relevant files found for this topic.'));
    return;
  }

  console.log(chalk.gray(`Found ${relevantFiles.length} relevant files`));

  // Read git log
  const commits = readGitLog(root);
  if (commits.length === 0) {
    console.log(chalk.yellow('\nNo git history found. Showing relevant files only:\n'));
    for (const f of relevantFiles.slice(0, 10)) {
      console.log(`  📄 ${path.relative(root, f)}`);
    }
    return;
  }

  const experts = findExperts(commits, relevantFiles);

  if (experts.length === 0) {
    console.log(chalk.yellow('No contributors found for these files.'));
    return;
  }

  console.log(chalk.bold('🏆 Expert Ranking:\n'));

  const maxScore = experts[0].score;
  experts.slice(0, 10).forEach((expert, i) => {
    const confidence = Math.round((expert.score / maxScore) * 100);
    const bar = '█'.repeat(Math.round(confidence / 10)) + '░'.repeat(10 - Math.round(confidence / 10));
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    console.log(`  ${medal} ${chalk.bold(expert.author)}`);
    console.log(`     ${chalk.yellow(bar)} ${confidence}% confidence`);
    console.log(`     Commits: ${expert.commits} total, ${expert.recentCommits} recent (90d)`);
    console.log(`     Files touched: ${expert.files.length}`);
    console.log();
  });

  console.log(chalk.bold('📄 Most relevant files:\n'));
  for (const f of relevantFiles.slice(0, 5)) {
    const rel = path.relative(root, f);
    const topExpert = experts.find(e => e.files.includes(f));
    console.log(`  ${chalk.cyan(rel)}${topExpert ? chalk.gray(` — ${topExpert.author}`) : ''}`);
  }
}
