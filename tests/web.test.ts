import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as nativeFs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Server } from 'http';
import type { WebServerOptions } from '../src/web/server.js';

interface ProjectIndex {
  files: Record<string, { hash: string; entities: Array<{ id: string; name: string }> }>;
  entities: Record<string, { name: string }>;
  edges: Array<{ from: string; to: string; kind: string }>;
}

describe('local web app', () => {
  let server: Server;
  let baseUrl: string;
  let projectRoot: string;
  let temporaryRoot: string;
  let originalDataDir: string | undefined;
  let originalGeminiKey: string | undefined;
  let originalGeminiModel: string | undefined;
  let testEnvPath: string;
  const realFetch = globalThis.fetch.bind(globalThis);

  beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-gpt-web-'));
    projectRoot = path.join(temporaryRoot, 'project');
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, 'src', 'auth.ts'),
      'export function authenticate(token: string) {\n  return validateToken(token);\n}\n',
    );
    await fs.writeFile(
      path.join(projectRoot, 'src', 'credentials.ts'),
      'export const api_key = "abcdefghijklmnop123456";\n',
    );
    await fs.writeFile(path.join(projectRoot, '.env'), 'GEMINI_API_KEY=not-a-source-file\n');

    originalDataDir = process.env.CODEBASE_GPT_DATA_DIR;
    originalGeminiKey = process.env.GEMINI_API_KEY;
    originalGeminiModel = process.env.GEMINI_MODEL;
    process.env.CODEBASE_GPT_DATA_DIR = path.join(temporaryRoot, 'local-data');
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;

    const { startWebServer } = await import('../src/web/server.js');
    server = await startWebServer(0, path.join(temporaryRoot, 'missing.env'));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Web server did not bind a TCP port.');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (originalDataDir === undefined) delete process.env.CODEBASE_GPT_DATA_DIR;
    else process.env.CODEBASE_GPT_DATA_DIR = originalDataDir;
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
    if (originalGeminiModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = originalGeminiModel;
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  it('indexes an explicitly selected project and serves bounded, cited source', async () => {
    const initialStatusResponse = await fetch(`${baseUrl}/api/status`);
    const initialStatus = await initialStatusResponse.json() as {
      connectionStatus: string;
      model: string;
      geminiConfigured: boolean;
    };
    expect(initialStatus).toMatchObject({
      connectionStatus: 'not_configured',
      model: 'gemini-3.8-flash',
      geminiConfigured: false,
    });

    const addProject = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: projectRoot }),
    });
    expect(addProject.status).toBe(200);

    const indexResult = await indexUntilDone(projectRoot);
    expect(indexResult.job.status).toBe('completed');
    const projectsResponse = await fetch(`${baseUrl}/api/projects`);
    const projects = await projectsResponse.json() as { projects: Array<{ root: string; fileCount: number }> };
    expect(projects.projects.find(project => project.root === projectRoot)?.fileCount).toBe(1);

    const search = await fetch(
      `${baseUrl}/api/search?${new URLSearchParams({ root: projectRoot, q: 'authenticate' })}`,
    );
    const searchResult = await search.json() as { results: Array<{ file: string; line?: number }> };
    expect(searchResult.results[0].file).toBe('src/auth.ts');
    expect(searchResult.results[0].line).toBe(1);

    const contentSearch = await fetch(
      `${baseUrl}/api/search?${new URLSearchParams({ root: projectRoot, q: 'validateToken' })}`,
    );
    const contentSearchResult = await contentSearch.json() as { results: Array<{ file: string; line?: number }> };
    expect(contentSearchResult.results).toContainEqual(expect.objectContaining({ file: 'src/auth.ts', line: 2 }));

    const ask = await fetch(`${baseUrl}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: projectRoot, question: 'Where is authenticate defined?' }),
    });
    const answer = await ask.json() as { mode: string; sources: Array<{ file: string; startLine: number }> };
    expect(answer.mode).toBe('retrieval-only');
    expect(answer.sources[0]).toMatchObject({ file: 'src/auth.ts', startLine: 1 });

    const traversal = await fetch(
      `${baseUrl}/api/source?${new URLSearchParams({ root: projectRoot, file: '..\\outside.ts' })}`,
    );
    expect(traversal.status).toBe(400);

    const prompt = await fetch(`${baseUrl}/api/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: projectRoot, question: 'Add auth token expiry validation to authenticate.' }),
    });
    const promptResult = await prompt.json() as { prompt: string };
    expect(promptResult.prompt).toContain('src/auth.ts');
    expect(promptResult.prompt).toContain('Completion criteria');

    testEnvPath = path.join(temporaryRoot, 'server.env');
    await fs.writeFile(testEnvPath, 'GEMINI_API_KEY=test-only-key\nGEMINI_MODEL=test-model\n');
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    server = await (await import('../src/web/server.js')).startWebServer(0, testEnvPath);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Web server did not restart.');
    baseUrl = `http://127.0.0.1:${address.port}`;

    const status = await realFetch(`${baseUrl}/api/status`);
    const statusBody = await status.json() as { connectionStatus: string; model: string; geminiConfigured: boolean };
    expect(statusBody).toMatchObject({ connectionStatus: 'untested', model: 'test-model', geminiConfigured: true });
    expect(JSON.stringify(statusBody)).not.toContain('test-only-key');
    const htmlResponse = await realFetch(`${baseUrl}/`);
    expect(htmlResponse.status).toBe(200);
    expect(await htmlResponse.text()).toContain('Check Gemini');
    const frontendResponse = await realFetch(`${baseUrl}/app.js`);
    expect(await frontendResponse.text()).not.toContain('GEMINI_API_KEY');

    const geminiFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (!url.startsWith('https://generativelanguage.googleapis.com/')) {
        return realFetch(input, init);
      }
      const requestBody = JSON.parse(String(init?.body)) as {
        contents: Array<{ parts: Array<{ text: string }> }>;
        systemInstruction?: { parts?: Array<{ text?: string }> };
      };
      expect(url).toContain('/models/test-model:generateContent');
      expect(init?.headers).toMatchObject({ 'x-goog-api-key': 'test-only-key' });
      const prompt = requestBody.contents[0].parts[0].text;
      if (requestBody.systemInstruction?.parts?.[0]?.text?.includes('connection test')) {
        expect(prompt).toBe('Reply with exactly the word OK.');
        expect(prompt).not.toContain('validateToken');
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'OK' }] } }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      expect(prompt).toContain('Where is authenticate defined?');
      expect(prompt).toContain('validateToken');
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'authenticate is defined in the retrieved source [S1]. [S99] src/missing.ts:88.' }] } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', geminiFetch);

    const connectionTest = await realFetch(`${baseUrl}/api/gemini/test`, { method: 'POST' });
    const connectionResult = await connectionTest.json() as { ok: boolean; connectionStatus: string };
    expect(connectionResult).toMatchObject({ ok: true, connectionStatus: 'connected' });
    const geminiAnswerResponse = await realFetch(`${baseUrl}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: projectRoot, question: 'Where is authenticate defined?' }),
    });
    const geminiAnswer = await geminiAnswerResponse.json() as {
      mode: string;
      answer: string;
      sources: Array<{ file: string; startLine: number; endLine: number }>;
    };
    expect(geminiAnswer.mode).toBe('gemini');
    expect(new Set(geminiAnswer.sources.map(source => `${source.file}:${source.startLine}-${source.endLine}`)).size)
      .toBe(geminiAnswer.sources.length);
    expect(geminiAnswer.answer).toContain(`[${geminiAnswer.sources[0].file}:${geminiAnswer.sources[0].startLine}-${geminiAnswer.sources[0].endLine}]`);
    expect(geminiAnswer.answer).toContain('[unverified citation removed]');
    expect(geminiAnswer.answer).toContain('[unverified file/line reference removed]');

    const askWithGemini = () => realFetch(`${baseUrl}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: projectRoot, question: 'Where is authenticate defined?' }),
    });
    const failures: Array<{ status: number; detail: { status: string; message: string }; category: string }> = [
      { status: 400, detail: { status: 'INVALID_ARGUMENT', message: 'Invalid model request.' }, category: 'error' },
      { status: 401, detail: { status: 'UNAUTHENTICATED', message: 'Invalid key.' }, category: 'invalid_credentials' },
      { status: 403, detail: { status: 'PERMISSION_DENIED', message: 'Access denied.' }, category: 'invalid_credentials' },
      { status: 403, detail: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded.' }, category: 'rate_limited' },
      { status: 429, detail: { status: 'RESOURCE_EXHAUSTED', message: 'Rate limit exceeded.' }, category: 'rate_limited' },
      { status: 500, detail: { status: 'INTERNAL', message: 'Service unavailable.' }, category: 'error' },
    ];
    for (const failure of failures) {
      geminiFetch.mockImplementationOnce(async () => new Response(JSON.stringify({
        error: failure.detail,
      }), { status: failure.status, headers: { 'Content-Type': 'application/json' } }));
      const response = await askWithGemini();
      const result = await response.json() as { mode: string; errorCategory: string; sources: unknown[] };
      expect(result.mode).toBe('gemini-error');
      expect(result.errorCategory).toBe(failure.category);
      expect(result.sources.length).toBeGreaterThan(0);
    }

    geminiFetch.mockImplementationOnce(async () => {
      throw new TypeError('Network failure.');
    });
    const networkResponse = await askWithGemini();
    const networkResult = await networkResponse.json() as { mode: string; errorCategory: string; sources: unknown[] };
    expect(networkResult).toMatchObject({ mode: 'gemini-error', errorCategory: 'error' });
    expect(networkResult.sources.length).toBeGreaterThan(0);
    geminiFetch.mockImplementationOnce(async () => {
      const timeout = new Error('Timed out.');
      timeout.name = 'TimeoutError';
      throw timeout;
    });
    const timeoutResponse = await askWithGemini();
    const timeoutResult = await timeoutResponse.json() as { mode: string; errorCategory: string; answer: string };
    expect(timeoutResult).toMatchObject({ mode: 'gemini-error', errorCategory: 'error' });
    expect(timeoutResult.answer).toContain('timed out');
    expect(geminiFetch).toHaveBeenCalledTimes(10);
    vi.unstubAllGlobals();
  });

  async function restartServer(options: WebServerOptions = {}) {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server = await (await import('../src/web/server.js')).startWebServer(0, testEnvPath, options);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Web server did not restart.');
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async function addProject(root: string): Promise<void> {
    const response = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root }),
    });
    expect(response.status).toBe(200);
  }

  async function indexUntilDone(root: string): Promise<{
    job: {
      status: string;
      failureCount: number;
      stats: Record<string, number>;
      skippedReasons: Record<string, number>;
      error: string | null;
    };
  }> {
    let response = await fetch(`${baseUrl}/api/index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root }),
    });
    let result = await response.json() as { job: { status: string; failureCount: number; stats: Record<string, number>; error: string | null } };
    for (let batch = 0; batch < 100 && (result.job.status === 'partial' || result.job.status === 'queued'); batch++) {
      if (result.job.failureCount > 0) break;
      response = await fetch(`${baseUrl}/api/index/continue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root }),
      });
      result = await response.json() as typeof result;
    }
    return result;
  }

  async function readProjectIndex(root: string): Promise<ProjectIndex> {
    const id = crypto.createHash('sha256').update(root).digest('hex');
    const file = path.join(temporaryRoot, 'local-data', 'indexes', `${id}.json`);
    return JSON.parse(await fs.readFile(file, 'utf8')) as ProjectIndex;
  }

  it('scans and indexes in bounded batches, then incrementally reflects additions, edits, and deletions', async () => {
    const root = path.join(temporaryRoot, 'incremental-project');
    await fs.mkdir(path.join(root, 'src', 'nested'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'alpha.ts'), "import { beta } from './nested/beta';\nexport function alpha() { return beta(); }\n");
    await fs.writeFile(path.join(root, 'src', 'nested', 'beta.ts'), 'export function beta() { return 1; }\n');
    await restartServer({ scanDirectoriesPerBatch: 1, indexFilesPerBatch: 1, maxDirectoryEntries: 100 });
    await addProject(root);

    const firstBatch = await fetch(`${baseUrl}/api/index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root }),
    });
    const first = await firstBatch.json() as { job: { status: string; phase: string; scannedDirectories: number } };
    expect(first.job.phase).toBe('scan');
    expect(first.job.scannedDirectories).toBe(1);

    const complete = await indexUntilDone(root);
    expect(complete.job.status).toBe('completed');
    let kg = await readProjectIndex(root);
    expect(Object.keys(kg.files)).toHaveLength(2);
    expect(kg.edges).toEqual([{ from: path.join(root, 'src', 'alpha.ts'), to: path.join(root, 'src', 'nested', 'beta.ts'), kind: 'imports' }]);
    expect(new Set(kg.edges.map(edge => `${edge.from}\0${edge.to}\0${edge.kind}`)).size).toBe(kg.edges.length);

    await fs.writeFile(path.join(root, 'src', 'alpha.ts'), 'export function renamedAlpha() { return 2; }\n');
    await fs.writeFile(path.join(root, 'src', 'gamma.ts'), 'export function gamma() { return 3; }\n');
    await fs.rm(path.join(root, 'src', 'nested', 'beta.ts'));
    const refreshed = await indexUntilDone(root);
    expect(refreshed.job.status).toBe('completed');
    kg = await readProjectIndex(root);
    expect(Object.keys(kg.files)).toHaveLength(2);
    expect(Object.values(kg.entities).map(entity => entity.name)).toContain('renamedAlpha');
    expect(Object.values(kg.entities).map(entity => entity.name)).toContain('gamma');
    expect(Object.values(kg.entities).map(entity => entity.name)).not.toContain('alpha');
    expect(Object.values(kg.entities).map(entity => entity.name)).not.toContain('beta');
    expect(kg.edges).toHaveLength(0);

    const results = await fetch(`${baseUrl}/api/search?${new URLSearchParams({ root, q: 'renamedAlpha' })}`);
    const search = await results.json() as { results: Array<{ file: string }> };
    expect(search.results[0].file).toBe('src/alpha.ts');

    const savedKey = process.env.GEMINI_API_KEY;
    const savedModel = process.env.GEMINI_MODEL;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    try {
      const askResponse = await fetch(`${baseUrl}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root, question: 'Where is renamedAlpha defined?' }),
      });
      const answer = await askResponse.json() as {
        mode: string;
        answer: string;
        sources: Array<{ file: string; startLine: number; endLine: number }>;
      };
      expect(answer.mode).toBe('retrieval-only');
      expect(answer.sources[0]).toMatchObject({ file: 'src/alpha.ts', startLine: 1 });
      expect(answer.answer).toContain(`src/alpha.ts:${answer.sources[0].startLine}-${answer.sources[0].endLine}`);
    } finally {
      if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = savedKey;
      if (savedModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = savedModel;
    }
  });

  it('scans iterator results beyond the legacy 20,000-entry threshold', async () => {
    const root = path.join(temporaryRoot, 'large-entry-project');
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export function main() { return 1; }\n');
    await restartServer({ scanDirectoriesPerBatch: 1, indexFilesPerBatch: 1, maxDirectoryEntries: 21000 });
    await addProject(root);

    const realOpendir = nativeFs.promises.opendir;
    const syntheticEntries = Array.from({ length: 20001 }, (_, index) => ({
      name: `.ignored-${index}.txt`,
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isFile: () => true,
    } as unknown as nativeFs.Dirent));
    syntheticEntries.push({
      name: 'src',
      isSymbolicLink: () => false,
      isDirectory: () => true,
      isFile: () => false,
    } as unknown as nativeFs.Dirent);
    const syntheticDirectory = {
      async *[Symbol.asyncIterator]() {
        yield* syntheticEntries;
      },
    } as unknown as nativeFs.Dir;
    const opendirSpy = vi.spyOn(nativeFs.promises, 'opendir').mockImplementation(async directory => {
      if (path.resolve(String(directory)) === root) return syntheticDirectory;
      return realOpendir(directory);
    });
    try {
      const result = await indexUntilDone(root);
      expect(result.job.status).toBe('completed');
      expect(result.job.discovered).toBe(1);
      expect((await readProjectIndex(root)).files).toHaveProperty(path.join(root, 'src', 'main.ts'));
    } finally {
      opendirSpy.mockRestore();
    }
  });

  it('retrieves field schema, database write, transformations, callers, read conditions, and tests for a causal question', async () => {
    const root = path.join(temporaryRoot, 'job-period-project');
    const files: Record<string, string> = {
      'src/job/schema.ts': [
        'export interface JobRow {',
        '  name: string;',
        '  period?: number | null;',
        '}',
      ].join('\n'),
      'src/job/transform.ts': [
        "import { JobRow } from './schema';",
        'export function toJobValues(input: Partial<JobRow>) {',
        '  const values: Partial<JobRow> = { name: input.name };',
        '  if (input.period !== undefined) values.period = input.period;',
        '  return values;',
        '}',
      ].join('\n'),
      'src/db/jobs.ts': [
        "import { toJobValues } from '../job/transform';",
        "import { JobRow } from '../job/schema';",
        'export function insertJob(input: Partial<JobRow>) {',
        "  return db.insert('jobs').values(toJobValues(input));",
        '}',
      ].join('\n'),
      'src/jobs/scheduled.ts': [
        "import { insertJob } from '../db/jobs';",
        'export function createScheduledJob(period: number) {',
        '  return insertJob({ period });',
        '}',
      ].join('\n'),
      'src/jobs/manual.ts': [
        "import { insertJob } from '../db/jobs';",
        'export function createManualJob() {',
        "  return insertJob({ name: 'manual' });",
        '}',
      ].join('\n'),
      'src/scheduler/next-run.ts': [
        "import { JobRow } from '../job/schema';",
        'export function nextRun(job: JobRow) {',
        '  if (job.period == null) return null;',
        '  return calculateNext(job.period);',
        '}',
      ].join('\n'),
      'tests/jobs.test.ts': [
        "import { createManualJob } from '../src/jobs/manual';",
        "it('creates a manual job without a period', () => {",
        '  expect(createManualJob()).not.toHaveProperty("period");',
        '});',
      ].join('\n'),
    };
    for (const [relative, content] of Object.entries(files)) {
      const filePath = path.join(root, relative);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content);
    }
    await restartServer({ indexFilesPerBatch: 3, scanDirectoriesPerBatch: 2 });
    await addProject(root);
    expect((await indexUntilDone(root)).job.status).toBe('completed');
    const fieldSearch = await fetch(`${baseUrl}/api/search?${new URLSearchParams({ root, q: 'period' })}`);
    const fieldResults = await fieldSearch.json() as { results: Array<{ file: string; line?: number }> };
    expect(fieldResults.results.some(result => result.file === 'src/job/schema.ts')).toBe(true);
    expect(fieldResults.results.some(result => result.file === 'src/job/transform.ts')).toBe(true);

    const originalKey = process.env.GEMINI_API_KEY;
    const originalModel = process.env.GEMINI_MODEL;
    process.env.GEMINI_API_KEY = 'test-only-key';
    process.env.GEMINI_MODEL = 'test-model';
    let capturedPrompt = '';
    const geminiFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (!String(input).startsWith('https://generativelanguage.googleapis.com/')) return realFetch(input, init);
      const payload = JSON.parse(String(init?.body)) as {
        contents: Array<{ parts: Array<{ text: string }> }>;
        generationConfig: { maxOutputTokens: number };
      };
      capturedPrompt = payload.contents[0].parts[0].text;
      expect(payload.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(2048);
      expect(capturedPrompt).toContain('Tại sao');
      const excerptMatch = /Untrusted source excerpts \(JSON\):\s*([\s\S]+)$/.exec(capturedPrompt);
      if (!excerptMatch) throw new Error('Retrieved snippets were missing from the Gemini prompt.');
      const excerpts = JSON.parse(excerptMatch[1]) as Array<{ file: string; code: string }>;
      const includedFiles = new Set(excerpts.map(excerpt => excerpt.file));
      for (const relative of [
        'src/job/schema.ts',
        'src/job/transform.ts',
        'src/db/jobs.ts',
        'src/jobs/scheduled.ts',
        'src/jobs/manual.ts',
        'src/scheduler/next-run.ts',
        'tests/jobs.test.ts',
      ]) {
        expect(includedFiles.has(relative), `${relative} should be retrieved`).toBe(true);
      }
      expect(capturedPrompt.length).toBeLessThan(20000);
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: '**Kết luận:** Job tạo từ lịch truyền `period`, còn job thủ công không truyền trường này. [S1] [S1]\n\n- Nhánh mapper chỉ gán trường khi giá trị tồn tại. [S2]\n\nChưa xác minh [S99] src/not-real.ts:2.',
            }],
          },
          finishReason: 'MAX_TOKENS',
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', geminiFetch);
    try {
      const response = await realFetch(`${baseUrl}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root,
          question: 'Tại sao khi chạy các scheduled job, khi lưu vào trong DB, có job thì có period, có job thì không có phần đó?',
        }),
      });
      const answer = await response.json() as {
        mode: string;
        answer: string;
        sources: Array<{ id: string; file: string; startLine: number; endLine: number }>;
        retrievalDiagnostics: {
          snippetCount: number;
          sourceChars: number;
          contextChars: number;
          outputChars: number;
          snippets: Array<{ rank: number; file: string; reason: string[] }>;
        };
        truncated: boolean;
      };
      expect(answer.mode).toBe('gemini');
      expect(answer.truncated).toBe(true);
      expect(answer.answer).toContain('**Kết luận:**');
      expect(answer.answer).not.toContain('[S1]');
      const firstCitation = `[${answer.sources[0].file}:${answer.sources[0].startLine}-${answer.sources[0].endLine}]`;
      expect(answer.answer).toContain(firstCitation);
      expect(answer.answer.match(new RegExp(firstCitation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);
      expect(answer.answer).toContain('[unverified citation removed]');
      expect(answer.answer).toContain('[unverified file/line reference removed]');
      expect(answer.retrievalDiagnostics).toMatchObject({
        snippetCount: answer.sources.length,
        sourceChars: expect.any(Number),
        contextChars: expect.any(Number),
        outputChars: answer.answer.length,
      });
      expect(answer.retrievalDiagnostics.sourceChars).toBeLessThanOrEqual(16000);
      expect(answer.retrievalDiagnostics.contextChars).toBeGreaterThan(answer.retrievalDiagnostics.sourceChars);
      expect(answer.retrievalDiagnostics.snippets[0].rank).toBe(1);
      expect(answer.retrievalDiagnostics.snippets[0].file).not.toBe('tests/jobs.test.ts');
      expect(answer.retrievalDiagnostics.snippets.some(item =>
        item.file === 'src/job/transform.ts' && item.reason.some(reason => reason.includes('exact field/name')),
      )).toBe(true);

      geminiFetch.mockImplementationOnce(async () => new Response(JSON.stringify({
        candidates: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      const malformed = await realFetch(`${baseUrl}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root, question: 'Which condition uses period?' }),
      });
      const malformedResult = await malformed.json() as {
        mode: string;
        sources: unknown[];
        retrievalDiagnostics: { snippetCount: number };
      };
      expect(malformedResult.mode).toBe('gemini-error');
      expect(malformedResult.sources.length).toBeGreaterThan(0);
      expect(malformedResult.retrievalDiagnostics.snippetCount).toBeGreaterThan(0);
      expect(capturedPrompt).not.toContain('test-only-key');

      const longAnswer = 'Verified output line. '.repeat(650);
      geminiFetch.mockImplementationOnce(async () => new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: longAnswer }] }, finishReason: 'STOP' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      const longOutput = await realFetch(`${baseUrl}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root, question: 'Which condition uses period?' }),
      });
      const longOutputResult = await longOutput.json() as { answer: string; truncated: boolean };
      expect(longOutputResult.answer.length).toBeGreaterThan(12000);
      expect(longOutputResult.truncated).toBe(false);

      const insufficient = await realFetch(`${baseUrl}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root, question: 'Explain unknownQuantumFeatureZZZ.' }),
      });
      const insufficientResult = await insufficient.json() as {
        mode: string;
        answer: string;
        sources: unknown[];
        retrievalDiagnostics: { snippetCount: number };
      };
      expect(insufficientResult.mode).toBe('retrieval-only');
      expect(insufficientResult.answer).toContain('not enough evidence');
      expect(insufficientResult.sources).toHaveLength(0);
      expect(insufficientResult.retrievalDiagnostics.snippetCount).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = originalKey;
      if (originalModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = originalModel;
    }
  });

  it('recovers a checkpoint after server restart and serializes concurrent batch requests', async () => {
    const root = path.join(temporaryRoot, 'resume-project');
    await fs.mkdir(path.join(root, 'a'), { recursive: true });
    await fs.mkdir(path.join(root, 'b'), { recursive: true });
    await fs.writeFile(path.join(root, 'a', 'one.ts'), 'export function one() { return 1; }\n');
    await fs.writeFile(path.join(root, 'b', 'two.ts'), 'export function two() { return 2; }\n');
    await restartServer({ scanDirectoriesPerBatch: 1, indexFilesPerBatch: 1, maxDirectoryEntries: 100 });
    await addProject(root);
    const started = await fetch(`${baseUrl}/api/index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root }),
    });
    const startedResult = await started.json() as { job: { status: string } };
    expect(startedResult.job.status).toBe('partial');

    const id = crypto.createHash('sha256').update(root).digest('hex');
    const jobPath = path.join(temporaryRoot, 'local-data', 'indexes', `${id}.json.job.json`);
    const checkpoint = JSON.parse(await fs.readFile(jobPath, 'utf8')) as { status: string };
    checkpoint.status = 'indexing';
    await fs.writeFile(jobPath, JSON.stringify(checkpoint));
    await restartServer({ scanDirectoriesPerBatch: 1, indexFilesPerBatch: 1, maxDirectoryEntries: 100 });
    const status = await fetch(`${baseUrl}/api/index/status?${new URLSearchParams({ root })}`);
    const restored = await status.json() as { job: { status: string; phase: string } };
    expect(restored.job.status).toBe('partial');

    const concurrent = await Promise.all([
      fetch(`${baseUrl}/api/index/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root }),
      }),
      fetch(`${baseUrl}/api/index/continue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root }),
      }),
    ]);
    for (const response of concurrent) expect(response.status).toBe(200);
    const finished = await indexUntilDone(root);
    expect(finished.job.status).toBe('completed');
    const kg = await readProjectIndex(root);
    expect(Object.keys(kg.files)).toHaveLength(2);
    expect(Object.keys(kg.entities)).toHaveLength(2);
    expect(new Set(kg.edges.map(edge => `${edge.from}\0${edge.to}\0${edge.kind}`)).size).toBe(kg.edges.length);
  });

  it('keeps the previous published index on a file failure and resumes the failed file', async () => {
    const root = path.join(temporaryRoot, 'file-error-project');
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    const stablePath = path.join(root, 'src', 'stable.ts');
    await fs.writeFile(stablePath, 'export function stable() { return 1; }\n');
    await restartServer({ indexFilesPerBatch: 1, maxDirectoryEntries: 100 });
    await addProject(root);
    expect((await indexUntilDone(root)).job.status).toBe('completed');
    const original = await readProjectIndex(root);

    await fs.writeFile(stablePath, 'export function changedStable() { return 2; }\n');
    await fs.writeFile(path.join(root, 'src', 'z-failing.ts'), 'export function retryMe() { return 3; }\n');
    let shouldFail = true;
    await restartServer({
      indexFilesPerBatch: 1,
      maxDirectoryEntries: 100,
      beforeIndexFile: file => {
        if (file.endsWith('z-failing.ts') && shouldFail) {
          shouldFail = false;
          throw new Error('simulated transient read failure');
        }
      },
    });
    const partial = await indexUntilDone(root);
    expect(partial.job.status).toBe('partial');
    expect(partial.job.failureCount).toBe(1);
    const stillPublished = await readProjectIndex(root);
    expect(Object.keys(stillPublished.entities)).toEqual(Object.keys(original.entities));

    const resumed = await fetch(`${baseUrl}/api/index/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root }),
    });
    let resumeResult = await resumed.json() as { job: { status: string; failureCount: number } };
    for (let batch = 0; batch < 10 && resumeResult.job.status !== 'completed'; batch++) {
      if (resumeResult.job.status === 'partial' && resumeResult.job.failureCount > 0) {
        const retry = await fetch(`${baseUrl}/api/index/resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ root }),
        });
        resumeResult = await retry.json() as typeof resumeResult;
      } else {
        const next = await fetch(`${baseUrl}/api/index/continue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ root }),
        });
        resumeResult = await next.json() as typeof resumeResult;
      }
    }
    expect(resumeResult.job.status).toBe('completed');
    const updated = await readProjectIndex(root);
    expect(Object.values(updated.entities).map(entity => entity.name)).toContain('changedStable');
    expect(Object.values(updated.entities).map(entity => entity.name)).toContain('retryMe');
  });

  it('retains file, byte, secret, and symlink protections with explicit job outcomes', async () => {
    const root = path.join(temporaryRoot, 'safe-scan-project');
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'too-large.ts'), 'x'.repeat(80));
    await fs.writeFile(path.join(root, 'src', 'settings.ts'), 'export const password = "a-secret-value-that-is-long";\n');
    await fs.writeFile(path.join(root, 'src', 'safe.ts'), 'export function safe() { return 1; }\n');
    const outside = path.join(temporaryRoot, 'outside.ts');
    await fs.writeFile(outside, 'export function outside() { return 1; }\n');
    let symlinkCreated = false;
    try {
      await fs.symlink(outside, path.join(root, 'src', 'linked.ts'), 'file');
      symlinkCreated = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    }
    await restartServer({
      maxFileBytes: 64,
      maxTotalBytes: 1000,
      maxDirectoryEntries: 100,
      indexFilesPerBatch: 1,
    });
    await addProject(root);
    const result = await indexUntilDone(root);
    expect(result.job.status).toBe('completed');
    const kg = await readProjectIndex(root);
    expect(Object.values(kg.entities).map(entity => entity.name)).toContain('safe');
    expect(Object.values(kg.entities).map(entity => entity.name)).not.toContain('password');
    expect(Object.keys(kg.files).some(file => file.endsWith('too-large.ts'))).toBe(false);
    expect(Object.keys(kg.files).some(file => file.endsWith('linked.ts'))).toBe(false);
    expect(result.job.stats.skipped).toBeGreaterThan(0);
    expect(result.job.skippedReasons).toMatchObject({
      file_too_large: 1,
      credential_like_content: 1,
    });
    if (symlinkCreated) expect(result.job.skippedReasons.symlink).toBe(1);

    const limitedRoot = path.join(temporaryRoot, 'total-limit-project');
    await fs.mkdir(path.join(limitedRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(limitedRoot, 'src', 'a.ts'), 'export const a = 123456789;\n');
    await fs.writeFile(path.join(limitedRoot, 'src', 'b.ts'), 'export const b = 123456789;\n');
    await restartServer({ maxTotalBytes: 20, maxDirectoryEntries: 100 });
    await addProject(limitedRoot);
    const limited = await indexUntilDone(limitedRoot);
    expect(limited.job.status).toBe('failed');
    expect(limited.job.error).toContain('total-size safety limit');
    await expect(readProjectIndex(limitedRoot)).rejects.toThrow();
  });
});
