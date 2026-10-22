// Public API
export { parseFile, parseSource, detectLanguage, hashFile } from './parser/index.js';
export { Graph, detectCommunities } from './graph/index.js';
export { buildSearchIndex, search, expandContext } from './algorithms/search.js';
export { readGitLog, computeChangeCoupling, computeBusFactor, findExperts } from './algorithms/git.js';
export { loadIndex, saveIndex, collectFiles, findRoot } from './utils/index.js';
export type { KnowledgeGraph, CodeEntity, CodeEdge, FileInfo, ChangeCoupling, CommitRecord } from './types.js';
