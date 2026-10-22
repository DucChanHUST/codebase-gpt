const state = { projects: [], activeRoot: null };
const $ = selector => document.querySelector(selector);
const elements = {
  projectForm: $('#project-form'),
  projectRoot: $('#project-root'),
  projectList: $('#project-list'),
  welcome: $('#welcome'),
  projectView: $('#project-view'),
  activeName: $('#active-name'),
  activeRoot: $('#active-root'),
  indexButton: $('#index-button'),
  indexStatus: $('#index-status'),
  indexProgress: $('#index-progress'),
  indexProgressLabel: $('#index-progress-label'),
  indexProgressCount: $('#index-progress-count'),
  indexProgressBar: $('#index-progress-bar'),
  indexProgressDetails: $('#index-progress-details'),
  resumeButton: $('#resume-button'),
  providerStatus: $('#provider-status'),
  geminiTest: $('#gemini-test'),
  chatMessages: $('#chat-messages'),
  askForm: $('#ask-form'),
  question: $('#question'),
  promptForm: $('#prompt-form'),
  promptRequest: $('#prompt-request'),
  clarifications: $('#clarifications'),
  clarifyingQuestions: $('#clarifying-questions'),
  promptResult: $('#prompt-result'),
  generatedPrompt: $('#generated-prompt'),
  promptSources: $('#prompt-sources'),
  searchForm: $('#search-form'),
  searchQuery: $('#search-query'),
  searchResults: $('#search-results'),
  sourceDialog: $('#source-dialog'),
  sourceTitle: $('#source-title'),
  sourceRange: $('#source-range'),
  sourceContent: $('#source-content'),
  toast: $('#toast'),
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('The local server returned an invalid response.'); }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function notify(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', isError);
  elements.toast.classList.add('visible');
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => elements.toast.classList.remove('visible'), 3500);
}

function renderGeminiStatus(status, model) {
  const labels = {
    not_configured: 'Gemini not configured · retrieval-only available',
    untested: `Gemini configured · not tested${model ? ` · ${model}` : ''}`,
    connected: `Gemini connected${model ? ` · ${model}` : ''}`,
    rate_limited: 'Gemini rate limit or quota exceeded',
    invalid_credentials: 'Gemini API key or access invalid',
    error: 'Gemini connection error',
  };
  elements.providerStatus.textContent = labels[status] || labels.error;
  elements.providerStatus.dataset.status = status;
  elements.providerStatus.classList.toggle('ready', status === 'connected');
  elements.providerStatus.classList.toggle('warning', status === 'not_configured' || status === 'untested' || status === 'rate_limited');
  elements.providerStatus.classList.toggle('error', status === 'invalid_credentials' || status === 'error');
  elements.geminiTest.disabled = status === 'not_configured';
}

async function refreshGeminiStatus() {
  const status = await api('/api/status');
  renderGeminiStatus(status.connectionStatus, status.model);
  return status;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
  } else {
    button.textContent = button.dataset.originalText || label;
  }
}

function activeProject() {
  return state.projects.find(project => project.root === state.activeRoot) || null;
}

function renderProjects() {
  elements.projectList.replaceChildren();
  for (const project of state.projects) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `project-item${project.root === state.activeRoot ? ' active' : ''}`;
    const name = document.createElement('strong');
    name.textContent = project.name;
    const status = document.createElement('small');
    status.textContent = project.indexedAt ? `${project.fileCount} files · indexed` : 'Index not built';
    button.append(name, status);
    button.addEventListener('click', () => selectProject(project.root));
    elements.projectList.append(button);
  }
}

function selectProject(root) {
  state.activeRoot = root;
  const project = activeProject();
  elements.welcome.classList.add('hidden');
  elements.projectView.classList.remove('hidden');
  elements.activeName.textContent = project.name;
  elements.activeRoot.textContent = project.root;
  elements.indexButton.textContent = project.indexedAt ? 'Refresh index' : 'Build index';
  if (project.indexJob) {
    renderIndexJob(project.indexJob, project);
  } else {
    elements.indexStatus.textContent = project.indexedAt
      ? `Index ready · ${project.fileCount} files · ${project.entityCount} symbols · ${new Date(project.indexedAt).toLocaleString()}`
      : 'Index not built yet.';
    elements.indexProgress.classList.add('hidden');
    elements.resumeButton.classList.add('hidden');
    elements.indexButton.classList.remove('hidden');
  }
  renderProjects();
}

function renderIndexJob(job, project = activeProject()) {
  if (!job) return;
  elements.indexProgress.classList.remove('hidden');
  elements.indexProgressLabel.textContent = job.status;
  elements.resumeButton.classList.toggle('hidden', !['partial', 'queued', 'indexing'].includes(job.status));
  elements.indexButton.classList.toggle('hidden', ['partial', 'queued', 'indexing'].includes(job.status));
  elements.indexProgressBar.removeAttribute('value');
  if (job.total !== null && job.total > 0) {
    const percentage = job.status === 'completed'
      ? 100
      : Math.min(99, Math.floor((job.processed / job.total) * 100));
    elements.indexProgressBar.value = percentage;
  } else if (job.status === 'completed') {
    elements.indexProgressBar.value = 100;
  }
  elements.indexProgressCount.textContent = job.total === null
    ? `${job.processed} processed · ${job.discovered} source files discovered`
    : `${job.processed} / ${job.total} files · ${job.total === 0 ? 100 : Math.floor((job.processed / job.total) * 100)}%`;
  const counts = job.stats;
  const details = [
    `${counts.added} new`,
    `${counts.updated} updated`,
    `${counts.skipped} skipped`,
    `${counts.failed} failed`,
    `${job.scannedDirectories} directories · ${job.scannedEntries} entries scanned`,
  ];
  if (job.error) details.push(job.error);
  elements.indexProgressDetails.textContent = details.join(' · ');
  elements.indexStatus.textContent = job.status === 'completed'
    ? `Index ready · ${project?.fileCount ?? job.total} files · ${project?.entityCount ?? 0} symbols.`
    : job.status === 'failed'
      ? `Index job failed. The last completed index was preserved. ${job.error || ''}`
      : `${job.phase === 'scan' ? 'Scanning project' : 'Indexing source files'} · the previous completed index remains available until this refresh completes.`;
  elements.indexButton.textContent = project?.indexedAt ? 'Refresh index' : 'Build index';
}

async function loadProjects() {
  const data = await api('/api/projects');
  state.projects = data.projects;
  renderProjects();
  if (state.activeRoot && state.projects.some(project => project.root === state.activeRoot)) {
    selectProject(state.activeRoot);
  } else if (state.projects.length > 0) {
    selectProject(state.projects[0].root);
  } else {
    state.activeRoot = null;
    elements.projectView.classList.add('hidden');
    elements.welcome.classList.remove('hidden');
  }
}

function appendMessage(label, text, className, sources = [], diagnostics = null, truncated = false) {
  const message = document.createElement('article');
  message.className = `message ${className}`;
  const heading = document.createElement('div');
  heading.className = 'message-label';
  heading.textContent = label;
  const body = document.createElement(className === 'assistant' ? 'div' : 'p');
  body.className = 'message-body';
  if (className === 'assistant') renderAnswer(body, text, sources);
  else body.textContent = text;
  message.append(heading, body);
  if (sources.length > 0) message.append(renderSources(sources));
  if (diagnostics) message.append(renderRetrievalDiagnostics(diagnostics));
  if (truncated) {
    const warning = document.createElement('div');
    warning.className = 'answer-truncated';
    warning.textContent = 'Gemini reached its output limit; this answer may be incomplete.';
    message.append(warning);
  }
  elements.chatMessages.append(message);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function renderSources(sources) {
  const list = document.createElement('div');
  list.className = 'source-list';
  const seen = new Set();
  for (const source of sources) {
    const key = `${source.file}:${source.startLine}-${source.endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'source-button';
    button.textContent = `${source.file}:${source.startLine}-${source.endLine}`;
    button.addEventListener('click', () => openSource(source.file, source.startLine));
    list.append(button);
  }
  return list;
}

function appendInlineMarkdown(parent, text, sources) {
  const tokens = text.match(/`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]/g) || [];
  let offset = 0;
  for (const token of tokens) {
    const index = text.indexOf(token, offset);
    if (index > offset) parent.append(document.createTextNode(text.slice(offset, index)));
    if (token.startsWith('`')) {
      const code = document.createElement('code');
      code.textContent = token.slice(1, -1);
      parent.append(code);
    } else if (token.startsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = token.slice(2, -2);
      parent.append(strong);
    } else {
      const citation = token.slice(1, -1);
      const source = sources.find(item => `${item.file}:${item.startLine}-${item.endLine}` === citation);
      if (source) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'inline-citation';
        button.textContent = token;
        button.addEventListener('click', () => openSource(source.file, source.startLine));
        parent.append(button);
      } else {
        parent.append(document.createTextNode(token));
      }
    }
    offset = index + token.length;
  }
  if (offset < text.length) parent.append(document.createTextNode(text.slice(offset)));
}

function renderAnswer(container, text, sources) {
  const lines = text.split(/\r?\n/);
  let paragraph = [];
  let list = null;
  let listKind = null;
  let codeLines = null;
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const element = document.createElement('p');
    appendInlineMarkdown(element, paragraph.join(' '), sources);
    container.append(element);
    paragraph = [];
  };
  const flushList = () => {
    if (list) container.append(list);
    list = null;
    listKind = null;
  };

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      flushParagraph();
      flushList();
      if (codeLines) {
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = codeLines.join('\n');
        pre.append(code);
        container.append(pre);
        codeLines = null;
      } else {
        codeLines = [];
      }
      continue;
    }
    if (codeLines) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const element = document.createElement(`h${heading[1].length + 2}`);
      appendInlineMarkdown(element, heading[2], sources);
      container.append(element);
      continue;
    }
    const item = /^\s*[-*]\s+(.+)$/.exec(line);
    const numberedItem = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (item || numberedItem) {
      flushParagraph();
      const nextListKind = item ? 'ul' : 'ol';
      if (list && listKind !== nextListKind) flushList();
      if (!list) {
        listKind = nextListKind;
        list = document.createElement(listKind);
      }
      const element = document.createElement('li');
      appendInlineMarkdown(element, (item || numberedItem)[1], sources);
      list.append(element);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  if (codeLines) {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = codeLines.join('\n');
    pre.append(code);
    container.append(pre);
  }
  flushParagraph();
  flushList();
}

function renderRetrievalDiagnostics(diagnostics) {
  const details = document.createElement('details');
  details.className = 'retrieval-diagnostics';
  const summary = document.createElement('summary');
  summary.textContent = `Retrieval · ${diagnostics.snippetCount} snippets · ${diagnostics.sourceChars} source chars · ${diagnostics.contextChars} context chars · ${diagnostics.outputChars} output chars`;
  details.append(summary);
  const list = document.createElement('ol');
  for (const item of diagnostics.snippets) {
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'diagnostic-source';
    button.textContent = `#${item.rank} ${item.file}:${item.startLine}-${item.endLine} · score ${item.score}`;
    button.addEventListener('click', () => openSource(item.file, item.startLine));
    row.append(button);
    const reason = document.createElement('small');
    reason.textContent = item.reason.join(' · ');
    row.append(reason);
    list.append(row);
  }
  details.append(list);
  return details;
}

async function openSource(file, line = 1) {
  try {
    const params = new URLSearchParams({ root: state.activeRoot, file, line: String(line) });
    const data = await api(`/api/source?${params}`);
    elements.sourceTitle.textContent = data.file;
    elements.sourceRange.textContent = `Lines ${data.startLine}-${data.endLine} of ${data.totalLines}`;
    elements.sourceContent.textContent = data.content;
    elements.sourceDialog.showModal();
  } catch (error) {
    notify(error.message, true);
  }
}

$('#chat-tab').addEventListener('click', () => setTab('chat'));
$('#prompt-tab').addEventListener('click', () => setTab('prompt'));

function setTab(tab) {
  const chatActive = tab === 'chat';
  $('#chat-tab').classList.toggle('active', chatActive);
  $('#chat-tab').setAttribute('aria-selected', String(chatActive));
  $('#prompt-tab').classList.toggle('active', !chatActive);
  $('#prompt-tab').setAttribute('aria-selected', String(!chatActive));
  $('#chat-panel').classList.toggle('hidden', !chatActive);
  $('#prompt-panel').classList.toggle('hidden', chatActive);
}

elements.projectForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = elements.projectForm.querySelector('button');
  setBusy(button, true, '…');
  try {
    const data = await api('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ root: elements.projectRoot.value.trim() }),
    });
    await loadProjects();
    selectProject(data.project.root);
    elements.projectRoot.value = '';
    notify('Project added. Build its index to get started.');
  } catch (error) {
    notify(error.message, true);
  } finally {
    setBusy(button, false, '+');
  }
});

elements.indexButton.addEventListener('click', async () => {
  if (!state.activeRoot) return;
  const root = state.activeRoot;
  const buttonLabel = elements.indexButton.textContent;
  setBusy(elements.indexButton, true, 'Starting…');
  try {
    const data = await api('/api/index', {
      method: 'POST',
      body: JSON.stringify({ root }),
    });
    await advanceIndexJob(root, data.job);
  } catch (error) {
    elements.indexStatus.textContent = error.message;
    notify(error.message, true);
  } finally {
    setBusy(elements.indexButton, false, buttonLabel);
    const project = activeProject();
    elements.indexButton.textContent = project?.indexedAt ? 'Refresh index' : 'Build index';
  }
});

async function runNextIndexBatch(root, endpoint) {
  return api(endpoint, {
    method: 'POST',
    body: JSON.stringify({ root }),
  });
}

function updateProjectFromIndexResponse(root, data) {
  state.projects = state.projects.map(project =>
    project.root === root ? { ...data.project, indexJob: data.job } : project,
  );
  if (state.activeRoot === root) {
    renderIndexJob(data.job, activeProject());
    renderProjects();
  }
}

async function advanceIndexJob(root, initialJob, resume = false) {
  let job = initialJob;
  const button = resume ? elements.resumeButton : elements.indexButton;
  const label = button.textContent;
  setBusy(button, true, 'Indexing…');
  try {
    if (resume) {
      const data = await runNextIndexBatch(root, '/api/index/resume');
      job = data.job;
      updateProjectFromIndexResponse(root, data);
    }
    renderIndexJob(job, activeProject());
    while (job.status === 'indexing') {
      await new Promise(resolve => setTimeout(resolve, 200));
      const params = new URLSearchParams({ root });
      const data = await api(`/api/index/status?${params}`);
      job = data.job;
      updateProjectFromIndexResponse(root, data);
    }
    while (
      job.status === 'queued' ||
      (job.status === 'partial' &&
        (job.failureCount === 0 || (job.total !== null && job.processed < job.total)))
    ) {
      const data = await runNextIndexBatch(root, '/api/index/continue');
      job = data.job;
      updateProjectFromIndexResponse(root, data);
      while (job.status === 'indexing') {
        await new Promise(resolve => setTimeout(resolve, 200));
        const params = new URLSearchParams({ root });
        const status = await api(`/api/index/status?${params}`);
        job = status.job;
        updateProjectFromIndexResponse(root, status);
      }
    }
    if (job.status === 'completed') notify('Index refresh completed.');
    else if (job.status === 'failed') notify(job.error || 'Indexing stopped at a safety limit.', true);
    else if (job.failureCount > 0) notify(`${job.failureCount} files failed. Fix the issue and resume indexing to retry them.`, true);
  } catch (error) {
    try {
      const params = new URLSearchParams({ root });
      const data = await api(`/api/index/status?${params}`);
      job = data.job;
      if (job) updateProjectFromIndexResponse(root, data);
    } catch { /* The durable checkpoint can be checked after reconnecting. */ }
    notify(`${error.message} Any completed batches were checkpointed; resume when the server is available.`, true);
  } finally {
    setBusy(button, false, label);
    if (state.activeRoot === root) {
      renderIndexJob(job, activeProject());
      elements.indexButton.textContent = activeProject()?.indexedAt ? 'Refresh index' : 'Build index';
    }
  }
}

elements.resumeButton.addEventListener('click', async () => {
  if (!state.activeRoot) return;
  await advanceIndexJob(state.activeRoot, activeProject()?.indexJob, true);
});

elements.askForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!state.activeRoot) return notify('Add and select a project first.', true);
  const question = elements.question.value.trim();
  if (!question) return;
  appendMessage('YOU', question, 'user');
  elements.question.value = '';
  const placeholder = document.createElement('article');
  placeholder.className = 'message';
  placeholder.textContent = 'Retrieving relevant code…';
  elements.chatMessages.append(placeholder);
  const button = elements.askForm.querySelector('button');
  setBusy(button, true, 'Thinking…');
  try {
    const data = await api('/api/ask', {
      method: 'POST',
      body: JSON.stringify({ root: state.activeRoot, question }),
    });
    placeholder.remove();
    if (data.mode === 'gemini-error') {
      try { await refreshGeminiStatus(); } catch { /* Preserve the answer and retrieved source citations. */ }
      appendMessage(`GEMINI ERROR · ${data.errorCategory.replaceAll('_', ' ').toUpperCase()}`, data.answer, 'assistant', data.sources, data.retrievalDiagnostics);
    } else {
      if (data.mode === 'gemini') await refreshGeminiStatus();
      appendMessage(data.mode === 'gemini' ? 'GEMINI · EVIDENCE-BASED' : 'RETRIEVAL · NO MODEL', data.answer, 'assistant', data.sources, data.retrievalDiagnostics, data.truncated);
    }
  } catch (error) {
    placeholder.remove();
    appendMessage('REQUEST FAILED', error.message, 'assistant');
  } finally {
    setBusy(button, false, 'Ask ↗');
  }
});

elements.promptForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!state.activeRoot) return notify('Add and select a project first.', true);
  const button = elements.promptForm.querySelector('button');
  setBusy(button, true, 'Building…');
  try {
    const data = await api('/api/prompt', {
      method: 'POST',
      body: JSON.stringify({
        root: state.activeRoot,
        question: elements.promptRequest.value.trim(),
        clarifications: elements.clarifications.value.trim(),
      }),
    });
    elements.generatedPrompt.value = data.prompt;
    elements.promptSources.replaceChildren(renderSources(data.sources));
    elements.promptResult.classList.remove('hidden');
    elements.clarifyingQuestions.replaceChildren();
    if (data.questions.length > 0) {
      const heading = document.createElement('strong');
      heading.textContent = 'Clarify these details before asking Claude to edit:';
      const list = document.createElement('ul');
      for (const question of data.questions) {
        const item = document.createElement('li');
        item.textContent = question;
        list.append(item);
      }
      elements.clarifyingQuestions.append(heading, list);
      elements.clarifyingQuestions.classList.remove('hidden');
    } else {
      elements.clarifyingQuestions.classList.add('hidden');
    }
    notify('Prompt is ready. Review it before pasting into Claude Code.');
  } catch (error) {
    notify(error.message, true);
  } finally {
    setBusy(button, false, 'Build prompt ↗');
  }
});

$('#copy-prompt').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(elements.generatedPrompt.value);
    notify('Prompt copied to clipboard.');
  } catch {
    try {
      elements.generatedPrompt.select();
      if (!document.execCommand('copy')) throw new Error('Clipboard access was denied.');
      notify('Prompt copied to clipboard.');
    } catch {
      notify('Clipboard access is unavailable. Select and copy the prompt manually.', true);
    }
  }
});

elements.searchForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!state.activeRoot) return notify('Add and select a project first.', true);
  const query = elements.searchQuery.value.trim();
  if (!query) return;
  elements.searchResults.textContent = 'Searching…';
  try {
    const params = new URLSearchParams({ root: state.activeRoot, q: query });
    const data = await api(`/api/search?${params}`);
    elements.searchResults.replaceChildren();
    if (data.results.length === 0) {
      elements.searchResults.textContent = 'No indexed symbols or file summaries matched.';
      return;
    }
    for (const result of data.results) {
      const article = document.createElement('article');
      article.className = 'search-result';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'search-result-title';
      open.textContent = result.line ? `${result.name} · ${result.file}:${result.line}` : result.file;
      open.addEventListener('click', () => openSource(result.file, result.line || 1));
      const detail = document.createElement('small');
      detail.textContent = result.snippet || result.type;
      article.append(open, detail);
      elements.searchResults.append(article);
    }
  } catch (error) {
    elements.searchResults.textContent = '';
    notify(error.message, true);
  }
});

$('#close-source').addEventListener('click', () => elements.sourceDialog.close());
elements.sourceDialog.addEventListener('click', event => {
  if (event.target === elements.sourceDialog) elements.sourceDialog.close();
});

elements.geminiTest.addEventListener('click', async () => {
  setBusy(elements.geminiTest, true, 'Checking…');
  try {
    const result = await api('/api/gemini/test', { method: 'POST' });
    renderGeminiStatus(result.connectionStatus, result.model);
    if (result.ok) notify(`Gemini connection successful · ${result.model}`);
    else notify(result.message, true);
  } catch (error) {
    notify(error.message, true);
  } finally {
    setBusy(elements.geminiTest, false, 'Check Gemini');
    elements.geminiTest.disabled = elements.providerStatus.dataset.status === 'not_configured';
  }
});

async function initialize() {
  try {
    await refreshGeminiStatus();
    await loadProjects();
  } catch (error) {
    notify(error.message, true);
  }
}

initialize();
