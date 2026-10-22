import chalk from 'chalk';
import { loadIndex } from '../utils/index.js';
import { detectCommunities } from '../graph/index.js';
import * as path from 'path';

export async function mapCommand(root: string): Promise<void> {
  const kg = loadIndex(root);
  if (!kg) {
    console.error(chalk.red('No index found. Run `codebase-gpt index` first.'));
    process.exit(1);
  }

  const communities = detectCommunities(kg);
  const communityFiles: Record<number, string[]> = {};

  for (const [filePath, communityId] of Object.entries(communities)) {
    if (!communityFiles[communityId]) communityFiles[communityId] = [];
    communityFiles[communityId].push(filePath);
  }

  console.log(chalk.cyan('\n🗺️  Architecture Map\n'));

  // Build Mermaid graph
  const lines: string[] = ['```mermaid', 'graph TD'];

  // Module nodes
  const moduleNames: Record<number, string> = {};
  for (const [communityId, files] of Object.entries(communityFiles)) {
    const id = Number(communityId);
    // Derive module name from common path prefix
    const relFiles = files.map(f => path.relative(root, f));
    const commonDir = findCommonDir(relFiles);
    const moduleName = commonDir || `module_${id}`;
    moduleNames[id] = moduleName;
    const fileList = relFiles.slice(0, 5).join('<br/>');
    lines.push(`  M${id}["📦 ${moduleName}<br/>${fileList}"]`);
  }

  // Import edges between modules
  const moduleEdges = new Set<string>();
  for (const edge of kg.edges) {
    if (edge.kind !== 'imports') continue;
    const fromCommunity = communities[edge.from];
    const toCommunity = communities[edge.to];
    if (fromCommunity !== undefined && toCommunity !== undefined && fromCommunity !== toCommunity) {
      const key = `M${fromCommunity} --> M${toCommunity}`;
      moduleEdges.add(key);
    }
  }

  for (const e of moduleEdges) {
    lines.push(`  ${e}`);
  }

  lines.push('```');
  console.log(lines.join('\n'));

  console.log(chalk.bold('\n📦 Modules:\n'));
  for (const [id, files] of Object.entries(communityFiles)) {
    const modName = moduleNames[Number(id)];
    const topFiles = files.slice(0, 3).map(f => path.relative(root, f)).join(', ');
    console.log(`  ${chalk.yellow(modName)} (${files.length} files)`);
    console.log(`    ${chalk.gray(topFiles)}`);
  }

  // Top entry points by PageRank
  const topFiles = Object.entries(kg.pageRank)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (topFiles.length > 0) {
    console.log(chalk.bold('\n🚀 Entry Points (by PageRank):\n'));
    for (const [filePath, rank] of topFiles) {
      const rel = path.relative(root, filePath);
      console.log(`  ${chalk.cyan(rel)} ${chalk.gray(`(rank: ${rank.toFixed(4)})`)}`);
    }
  }
}

function findCommonDir(files: string[]): string {
  if (files.length === 0) return 'root';
  const parts = files[0].split(path.sep);
  let common = '';
  for (let i = 0; i < parts.length - 1; i++) {
    const prefix = parts.slice(0, i + 1).join(path.sep);
    if (files.every(f => f.startsWith(prefix))) {
      common = prefix;
    } else {
      break;
    }
  }
  return common || path.dirname(files[0]).split(path.sep)[0] || 'root';
}
