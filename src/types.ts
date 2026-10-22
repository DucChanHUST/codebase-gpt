// Types for the codebase-gpt knowledge graph

export type EntityKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'variable'
  | 'module'
  | 'method'
  | 'export';

export interface CodeEntity {
  id: string; // file:line:name
  name: string;
  kind: EntityKind;
  file: string;
  line: number;
  endLine?: number;
  exported: boolean;
  comment?: string;
  params?: string[];
  returnType?: string;
}

export interface CodeEdge {
  from: string; // entity id
  to: string; // entity id or file path
  kind: 'imports' | 'calls' | 'extends' | 'implements' | 'uses';
}

export interface FileInfo {
  path: string;
  hash: string;
  language: string;
  entities: CodeEntity[];
  imports: string[]; // resolved file paths
  exports: string[]; // entity names
  size: number;
  lastModified: number;
}

export interface CommitRecord {
  hash: string;
  date: string;
  author: string;
  email: string;
  message: string;
  files: string[];
}

export interface ChangeCoupling {
  fileA: string;
  fileB: string;
  coOccurrences: number;
  support: number; // fraction of commits both changed together
}

export interface KnowledgeGraph {
  version: string;
  root: string;
  indexedAt: string;
  files: Record<string, FileInfo>;
  entities: Record<string, CodeEntity>;
  edges: CodeEdge[];
  changeCoupling: ChangeCoupling[];
  summaries: Record<string, string>; // entity/file id -> summary
  pageRank: Record<string, number>;
}
