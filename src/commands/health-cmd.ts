import chalk from 'chalk';
import { loadIndex } from '../utils/index.js';
import { readGitLog, computeBusFactor } from '../algorithms/git.js';
import * as path from 'path';

export async function healthCommand(root: string): Promise<void> {
  const kg = loadIndex(root);
  if (!kg) {
    console.error(chalk.red('No index found. Run `codebase-gpt index` first.'));
    process.exit(1);
  }

  const files = Object.keys(kg.files);
  console.log(chalk.cyan('\n🏥 Codebase Health Report\n'));

  // ── 1. Complexity hotspots (high fan-in / fan-out) ──
  const fanIn: Record<string, number> = {};
  const fanOut: Record<string, number> = {};
  for (const f of files) { fanIn[f] = 0; fanOut[f] = 0; }
  for (const edge of kg.edges) {
    if (edge.kind === 'imports') {
      fanOut[edge.from] = (fanOut[edge.from] ?? 0) + 1;
      fanIn[edge.to] = (fanIn[edge.to] ?? 0) + 1;
    }
  }

  const hotspots = files
    .map(f => ({ file: f, fanIn: fanIn[f] ?? 0, fanOut: fanOut[f] ?? 0, score: (fanIn[f] ?? 0) + (fanOut[f] ?? 0) }))
    .filter(f => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  console.log(chalk.bold('🔥 Complexity Hotspots (fan-in + fan-out):\n'));
  if (hotspots.length === 0) {
    console.log(chalk.gray('  No import edges found.\n'));
  } else {
    for (const h of hotspots) {
      const rel = path.relative(root, h.file);
      const bar = '█'.repeat(Math.min(h.score, 20));
      console.log(`  ${chalk.yellow(bar)} ${chalk.bold(rel)}`);
      console.log(`    fan-in: ${h.fanIn}, fan-out: ${h.fanOut}`);
    }
    console.log();
  }

  // ── 2. Change coupling anomalies ──
  const moduleCoupled = kg.changeCoupling.filter(c => {
    const dirA = path.dirname(c.fileA);
    const dirB = path.dirname(c.fileB);
    return dirA !== dirB && c.support >= 0.5;
  });

  console.log(chalk.bold('⚡ Change Coupling Anomalies (cross-module, ≥50% co-change):\n'));
  if (moduleCoupled.length === 0) {
    console.log(chalk.gray('  No anomalies found.\n'));
  } else {
    for (const c of moduleCoupled.slice(0, 10)) {
      const a = path.relative(root, c.fileA);
      const b = path.relative(root, c.fileB);
      console.log(`  ${chalk.red('!')} ${a} ↔ ${b}`);
      console.log(`    Co-changed: ${c.coOccurrences}x, support: ${Math.round(c.support * 100)}%`);
    }
    console.log();
  }

  // ── 3. Dependency depth ──
  const maxDepth = computeMaxDepth(files, kg.edges);
  console.log(chalk.bold('📏 Max Dependency Depth:'));
  console.log(`  ${maxDepth.depth} hops — deepest chain ending at ${maxDepth.file ? path.relative(root, maxDepth.file) : 'N/A'}\n`);

  // ── 4. Dead code candidates ──
  const importedFiles = new Set(kg.edges.filter(e => e.kind === 'imports').map(e => e.to));
  const exportedEntities = Object.values(kg.entities).filter(e => e.exported);
  const importedEntityNames = new Set<string>();
  // Simple heuristic: entity name appears in any file's source
  for (const fileInfo of Object.values(kg.files)) {
    for (const name of fileInfo.imports) {
      importedEntityNames.add(name);
    }
  }

  const deadCandidates = exportedEntities
    .filter(e => !importedEntityNames.has(e.name))
    .slice(0, 10);

  console.log(chalk.bold('💀 Dead Code Candidates (exported but not imported):\n'));
  if (deadCandidates.length === 0) {
    console.log(chalk.gray('  No candidates found.\n'));
  } else {
    for (const e of deadCandidates) {
      const rel = path.relative(root, e.file);
      console.log(`  ${chalk.dim(e.kind)} ${chalk.bold(e.name)} @ ${chalk.gray(`${rel}:${e.line}`)}`);
    }
    console.log();
  }

  // ── 5. Bus factor ──
  const commits = readGitLog(root);
  if (commits.length > 0) {
    const busFactors = computeBusFactor(commits, files).filter(b => b.busFactor === 1).slice(0, 10);
    console.log(chalk.bold('🚌 Bus Factor = 1 (single point of failure):\n'));
    if (busFactors.length === 0) {
      console.log(chalk.gray('  All modules have bus factor > 1. 🎉\n'));
    } else {
      for (const b of busFactors) {
        const rel = path.relative(root, b.path);
        const top = b.contributors[0];
        console.log(`  ${chalk.red('!')} ${chalk.bold(rel)}`);
        console.log(`    Only contributor: ${top?.author ?? 'unknown'} (${Math.round((top?.fraction ?? 0) * 100)}%)`);
      }
      console.log();
    }
  }

  // ── Summary ──
  const entityCount = Object.keys(kg.entities).length;
  const fileCount = files.length;
  const edgeCount = kg.edges.length;
  console.log(chalk.bold('📊 Summary:'));
  console.log(`  Files: ${fileCount} | Entities: ${entityCount} | Import edges: ${edgeCount}`);
  console.log(`  Coupling pairs: ${kg.changeCoupling.length} | Hotspots: ${hotspots.length}`);
}

function computeMaxDepth(files: string[], edges: { from: string; to: string; kind: string }[]): { depth: number; file: string | null } {
  const graph: Record<string, string[]> = {};
  for (const f of files) graph[f] = [];
  for (const e of edges) {
    if (e.kind === 'imports' && graph[e.from]) graph[e.from].push(e.to);
  }

  let maxDepth = 0;
  let maxFile: string | null = null;

  const memo: Record<string, number> = {};

  function dfs(node: string, visited: Set<string>): number {
    if (memo[node] !== undefined) return memo[node];
    if (visited.has(node)) return 0; // cycle
    visited.add(node);
    let depth = 0;
    for (const neighbor of (graph[node] ?? [])) {
      depth = Math.max(depth, 1 + dfs(neighbor, new Set(visited)));
    }
    memo[node] = depth;
    return depth;
  }

  for (const f of files) {
    const d = dfs(f, new Set());
    if (d > maxDepth) { maxDepth = d; maxFile = f; }
  }

  return { depth: maxDepth, file: maxFile };
}
