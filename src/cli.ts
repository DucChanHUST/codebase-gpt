#!/usr/bin/env node
import { Command } from 'commander';
import * as path from 'path';
import { findRoot } from './utils/index.js';

const program = new Command();

program
  .name('codebase-gpt')
  .description('Local-first codebase intelligence — ask questions, map architecture, find experts')
  .version('0.1.0');

program
  .command('index')
  .description('Build knowledge graph of the codebase')
  .option('-r, --root <path>', 'Root directory to index', process.cwd())
  .option('-f, --force', 'Force full re-index (ignore incremental cache)')
  .option('-v, --verbose', 'Verbose output')
  .action(async (opts) => {
    const { indexCommand } = await import('./commands/index-cmd.js');
    const root = findRoot(path.resolve(opts.root));
    await indexCommand(root, { force: opts.force, verbose: opts.verbose });
  });

program
  .command('ask <question>')
  .description('Ask a question about the codebase')
  .option('-r, --root <path>', 'Root directory', process.cwd())
  .action(async (question, opts) => {
    const { askCommand } = await import('./commands/ask-cmd.js');
    const root = findRoot(path.resolve(opts.root));
    await askCommand(root, question);
  });

program
  .command('map')
  .description('Generate architecture overview (Mermaid diagram)')
  .option('-r, --root <path>', 'Root directory', process.cwd())
  .action(async (opts) => {
    const { mapCommand } = await import('./commands/map-cmd.js');
    const root = findRoot(path.resolve(opts.root));
    await mapCommand(root);
  });

program
  .command('who <topic>')
  .description('Who are the experts on a given topic?')
  .option('-r, --root <path>', 'Root directory', process.cwd())
  .action(async (topic, opts) => {
    const { whoCommand } = await import('./commands/who-cmd.js');
    const root = findRoot(path.resolve(opts.root));
    await whoCommand(root, topic);
  });

program
  .command('health')
  .description('Codebase health report')
  .option('-r, --root <path>', 'Root directory', process.cwd())
  .action(async (opts) => {
    const { healthCommand } = await import('./commands/health-cmd.js');
    const root = findRoot(path.resolve(opts.root));
    await healthCommand(root);
  });

program
  .command('diff')
  .description('Summarize what changed and why')
  .option('-r, --root <path>', 'Root directory', process.cwd())
  .option('--since <commit>', 'Since commit/tag/date (default: HEAD~10)')
  .action(async (opts) => {
    const { diffCommand } = await import('./commands/diff-cmd.js');
    const root = findRoot(path.resolve(opts.root));
    await diffCommand(root, { since: opts.since });
  });

program
  .command('web')
  .description('Start the local AI Project Copilot web app')
  .option('-p, --port <port>', 'Local port', process.env.PORT ?? '4173')
  .action(async (opts) => {
    const port = Number(opts.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error('Port must be an integer between 0 and 65535.');
    }
    const { startWebServer } = await import('./web/server.js');
    await startWebServer(port);
  });

program.parse(process.argv);
