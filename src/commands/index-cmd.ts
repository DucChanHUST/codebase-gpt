import chalk from 'chalk';
import { Graph } from '../graph/index.js';
import { parseFile } from '../parser/index.js';
import { readGitLog, computeChangeCoupling } from '../algorithms/git.js';
import { collectFiles, saveIndex, loadIndex, getIndexPath } from '../utils/index.js';
import * as path from 'path';

export async function indexCommand(root: string, options: { force?: boolean; verbose?: boolean }): Promise<void> {
  const indexPath = getIndexPath(root);
  const existing = options.force ? null : loadIndex(root);

  console.log(chalk.cyan('🔍 Scanning files...'));
  const files = await collectFiles(root);
  console.log(chalk.gray(`  Found ${files.length} source files`));

  const graph = new Graph(root);

  // Incremental: skip unchanged files
  let parsed = 0;
  let skipped = 0;

  for (const filePath of files) {
    const fileInfo = parseFile(filePath);
    if (!fileInfo) continue;

    // Incremental check
    if (existing && existing.files[filePath]?.hash === fileInfo.hash) {
      // Reuse existing
      graph.addFile(existing.files[filePath]);
      skipped++;
      continue;
    }

    graph.addFile(fileInfo);
    parsed++;
    if (options.verbose) {
      console.log(chalk.gray(`  Parsed: ${path.relative(root, filePath)}`));
    }
  }

  console.log(chalk.gray(`  Parsed: ${parsed} files, skipped (unchanged): ${skipped}`));

  console.log(chalk.cyan('🔗 Building import graph...'));
  graph.buildEdges();

  console.log(chalk.cyan('📊 Computing PageRank...'));
  graph.computePageRank();

  console.log(chalk.cyan('📝 Generating summaries...'));
  graph.buildSummaries();

  console.log(chalk.cyan('🕰️  Analyzing git history...'));
  const commits = readGitLog(root);
  if (commits.length > 0) {
    const coupling = computeChangeCoupling(commits);
    graph.kg.changeCoupling = coupling;
    console.log(chalk.gray(`  Found ${commits.length} commits, ${coupling.length} coupling pairs`));
  } else {
    console.log(chalk.gray('  No git history found'));
  }

  saveIndex(root, graph.toJSON());

  const kg = graph.toJSON();
  console.log(chalk.green('\n✅ Index built successfully'));
  console.log(chalk.white(`   Files indexed:   ${Object.keys(kg.files).length}`));
  console.log(chalk.white(`   Entities:        ${Object.keys(kg.entities).length}`));
  console.log(chalk.white(`   Import edges:    ${kg.edges.length}`));
  console.log(chalk.white(`   Coupling pairs:  ${kg.changeCoupling.length}`));
  console.log(chalk.gray(`\n   Index saved to: ${path.relative(root, indexPath)}`));
}
