import chalk from 'chalk';
import { loadIndex } from '../utils/index.js';
import { buildSearchIndex, search, expandContext } from '../algorithms/search.js';
import { execSync } from 'child_process';
import * as path from 'path';

export async function askCommand(root: string, question: string): Promise<void> {
  const kg = loadIndex(root);
  if (!kg) {
    console.error(chalk.red('No index found. Run `codebase-gpt index` first.'));
    process.exit(1);
  }

  console.log(chalk.cyan(`\n❓ Question: "${question}"\n`));

  const docs = buildSearchIndex(kg);
  const results = search(question, docs, 15);

  if (results.length === 0) {
    console.log(chalk.yellow('No relevant code found for this question.'));
    return;
  }

  // Expand context via graph traversal
  const fileIds = results.filter(r => r.type === 'file').map(r => r.id);
  const expanded = expandContext(fileIds, kg, 1);

  // If OpenAI key available, enhance with LLM
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    await answerWithLLM(question, results, kg, openaiKey, root);
    return;
  }

  // Template-based answer
  console.log(chalk.bold('📍 Relevant code:\n'));

  const entityResults = results.filter(r => r.type === 'entity').slice(0, 5);
  const fileResults = results.filter(r => r.type === 'file').slice(0, 5);

  if (entityResults.length > 0) {
    console.log(chalk.underline('Functions / Classes:'));
    for (const r of entityResults) {
      const entity = kg.entities[r.id];
      if (!entity) continue;
      const relFile = path.relative(root, entity.file);
      const kindColor = entity.kind === 'class' ? chalk.blue : entity.kind === 'function' ? chalk.green : chalk.cyan;
      console.log(`  ${kindColor(entity.kind)} ${chalk.bold(entity.name)} @ ${chalk.gray(`${relFile}:${entity.line}`)}`);
      if (entity.comment) console.log(`    ${chalk.italic(chalk.gray(entity.comment))}`);
      if (entity.params?.length) console.log(`    Params: ${entity.params.join(', ')}`);
    }
    console.log();
  }

  if (fileResults.length > 0) {
    console.log(chalk.underline('Files:'));
    for (const r of fileResults) {
      const fileInfo = kg.files[r.id];
      if (!fileInfo) continue;
      const relFile = path.relative(root, r.id);
      console.log(`  📄 ${chalk.bold(relFile)}`);
      const summary = kg.summaries[r.id];
      if (summary) console.log(`    ${chalk.gray(summary)}`);
    }
    console.log();
  }

  // Related files from coupling
  const questionFiles = new Set(results.map(r => r.file));
  const relatedCoupled = kg.changeCoupling
    .filter(c => questionFiles.has(c.fileA) || questionFiles.has(c.fileB))
    .slice(0, 3);

  if (relatedCoupled.length > 0) {
    console.log(chalk.underline('Often changed together:'));
    for (const c of relatedCoupled) {
      const a = path.relative(root, c.fileA);
      const b = path.relative(root, c.fileB);
      console.log(`  ${chalk.gray(`${a} ↔ ${b}`)} (${Math.round(c.support * 100)}% co-change)`);
    }
    console.log();
  }

  console.log(chalk.dim('💡 Tip: Set OPENAI_API_KEY for AI-enhanced answers.'));
}

async function answerWithLLM(
  question: string,
  results: ReturnType<typeof search>,
  kg: ReturnType<typeof loadIndex>,
  apiKey: string,
  root: string
): Promise<void> {
  if (!kg) return;
  const { default: https } = await import('https');

  const contextParts: string[] = [];
  for (const r of results.slice(0, 8)) {
    if (r.type === 'entity') {
      const entity = kg.entities[r.id];
      if (entity) {
        const rel = path.relative(root, entity.file);
        contextParts.push(`${entity.kind} ${entity.name} in ${rel}:${entity.line}${entity.comment ? ` — ${entity.comment}` : ''}`);
      }
    } else {
      const summary = kg.summaries[r.id];
      const rel = path.relative(root, r.id);
      if (summary) contextParts.push(`File ${rel}: ${summary}`);
    }
  }

  const systemPrompt = `You are a codebase expert assistant. Answer questions about code concisely and precisely, citing specific files and line numbers when possible.`;
  const userPrompt = `Codebase context:\n${contextParts.join('\n')}\n\nQuestion: ${question}\n\nAnswer concisely with references to files/functions.`;

  const body = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    max_tokens: 600,
  });

  const answer = await new Promise<string>((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    }, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.choices?.[0]?.message?.content ?? 'No answer from LLM.');
        } catch {
          reject(new Error('Failed to parse LLM response'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  console.log(chalk.bold('🤖 AI Answer:\n'));
  console.log(answer);
  console.log();
  console.log(chalk.bold('📍 Sources:'));
  for (const r of results.slice(0, 5)) {
    const rel = path.relative(root, r.file);
    console.log(`  ${chalk.gray(`${rel}${r.line ? `:${r.line}` : ''}`)}`);
  }
}
