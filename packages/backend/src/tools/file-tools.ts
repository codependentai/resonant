import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, isAbsolute, resolve } from 'path';
import { homedir, tmpdir } from 'os';
import { getResonantConfig } from '../config.js';
import type { InternalToolDefinition, InternalToolResult } from './internal-registry.js';

const DEFAULT_MAX_READ_CHARS = 120_000;
const DEFAULT_SEARCH_LIMIT = 80;
const DEFAULT_FILE_LIMIT = 2_000;
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.svelte-kit',
  '.next',
  'coverage',
  '__pycache__',
]);

interface FileToolConfig {
  agent: { cwd: string };
  hooks: { safe_write_prefixes: string[] };
}

function ok(text: string, data?: unknown): InternalToolResult {
  return { ok: true, text, data };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`);
  return value.trim();
}

function safeConfig(): FileToolConfig {
  try {
    const cfg = getResonantConfig();
    return {
      agent: { cwd: cfg.agent.cwd },
      hooks: { safe_write_prefixes: cfg.hooks.safe_write_prefixes || [] },
    };
  } catch {
    return {
      agent: { cwd: process.cwd() },
      hooks: { safe_write_prefixes: [] },
    };
  }
}

function normalizePath(rawPath: string): string {
  const cfg = safeConfig();
  return isAbsolute(rawPath)
    ? resolve(rawPath)
    : resolve(cfg.agent.cwd, rawPath);
}

function allowedWriteRoots(): string[] {
  const cfg = safeConfig();
  const configured = cfg.hooks.safe_write_prefixes || [];
  const roots = configured.length > 0
    ? configured
    : [
      cfg.agent.cwd,
      'C:/AI',
      homedir(),
      tmpdir(),
    ];
  return roots.map(root => resolve(root).toLowerCase());
}

function assertWritablePath(path: string): void {
  const normalized = resolve(path).toLowerCase();
  if (normalized.match(/^[a-z]:\\windows(\\|$)/i)) {
    throw new Error('Refusing to write inside Windows system directories.');
  }
  if (normalized.match(/^[a-z]:\\program files( \(x86\))?(\\|$)/i)) {
    throw new Error('Refusing to write inside Program Files.');
  }
  if (normalized.includes('\\.git\\')) {
    throw new Error('Refusing to write inside .git internals.');
  }

  const allowed = allowedWriteRoots();
  if (!allowed.some(root => normalized === root || normalized.startsWith(root + '\\'))) {
    throw new Error(`Path is outside configured writable roots: ${path}`);
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function backupFile(path: string): string | null {
  if (!existsSync(path)) return null;
  const backupPath = `${path}.bak-${timestamp()}`;
  writeFileSync(backupPath, readFileSync(path));
  return backupPath;
}

function formatEntry(path: string, root: string): string {
  const st = statSync(path);
  const rel = path.slice(root.length).replace(/^[/\\]/, '') || '.';
  const kind = st.isDirectory() ? 'dir ' : 'file';
  const size = st.isDirectory() ? '' : ` ${st.size}b`;
  return `${kind} ${rel}${size}`;
}

function walkFiles(root: string, opts: { recursive: boolean; maxFiles: number }): string[] {
  const files: string[] = [];
  const queue = [root];

  while (queue.length > 0 && files.length < opts.maxFiles) {
    const current = queue.shift()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env') continue;
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) {
        if (opts.recursive && !SKIP_DIRS.has(entry.name)) queue.push(path);
      } else if (entry.isFile()) {
        files.push(path);
        if (files.length >= opts.maxFiles) break;
      }
    }
  }

  return files;
}

function isProbablyText(path: string): boolean {
  const textExt = /\.(txt|md|mdx|json|jsonl|yaml|yml|toml|ini|env|ts|tsx|js|jsx|mjs|cjs|css|scss|html|svelte|py|ps1|bat|sh|sql|xml|csv|log)$/i;
  return textExt.test(path) || !/\.[a-z0-9]{2,8}$/i.test(path);
}

export const FILE_INTERNAL_TOOLS: InternalToolDefinition[] = [
  {
    name: 'file.stat',
    title: 'File Stat',
    description: 'Inspect whether a local path exists and whether it is a file or directory.',
    permission: 'read',
    timeoutMs: 3000,
    schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    cliExamples: ['file stat C:/AI/example.md'],
    handler: (args) => {
      const path = normalizePath(requireString(args, 'path'));
      if (!existsSync(path)) return { ok: false, text: `Path not found: ${path}`, error: 'not_found' };
      const st = statSync(path);
      return ok(`${st.isDirectory() ? 'Directory' : st.isFile() ? 'File' : 'Other'}: ${path}`, {
        path,
        isFile: st.isFile(),
        isDirectory: st.isDirectory(),
        size: st.size,
        modifiedAt: st.mtime.toISOString(),
      });
    },
  },
  {
    name: 'file.list',
    title: 'List Files',
    description: 'List local files and directories. Use when the user gives a folder path.',
    permission: 'read',
    timeoutMs: 10000,
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        recursive: { type: 'boolean' },
        maxEntries: { type: 'number' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    cliExamples: ['file list C:/AI/project'],
    handler: (args) => {
      const root = normalizePath(requireString(args, 'path'));
      if (!existsSync(root)) return { ok: false, text: `Path not found: ${root}`, error: 'not_found' };
      if (!statSync(root).isDirectory()) return { ok: false, text: `Not a directory: ${root}`, error: 'not_directory' };
      const recursive = args.recursive === true;
      const maxEntries = typeof args.maxEntries === 'number' ? Math.max(1, Math.min(args.maxEntries, 5000)) : 300;
      const paths: string[] = [];
      const queue = [root];

      while (queue.length > 0 && paths.length < maxEntries) {
        const current = queue.shift()!;
        const entries = readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          const path = resolve(current, entry.name);
          paths.push(path);
          if (recursive && entry.isDirectory() && !SKIP_DIRS.has(entry.name)) queue.push(path);
          if (paths.length >= maxEntries) break;
        }
      }

      return ok(paths.map(path => formatEntry(path, root)).join('\n') || '(empty)', {
        root,
        entries: paths,
        truncated: paths.length >= maxEntries,
      });
    },
  },
  {
    name: 'file.read',
    title: 'Read File',
    description: 'Read a local text file. Use this first when the user gives a local file path.',
    permission: 'read',
    timeoutMs: 10000,
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        offset: { type: 'number' },
        maxChars: { type: 'number' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    cliExamples: ['file read C:/AI/project/README.md'],
    handler: (args) => {
      const path = normalizePath(requireString(args, 'path'));
      if (!existsSync(path)) return { ok: false, text: `Path not found: ${path}`, error: 'not_found' };
      if (!statSync(path).isFile()) return { ok: false, text: `Not a file: ${path}`, error: 'not_file' };
      if (!isProbablyText(path)) return { ok: false, text: `Refusing to read likely-binary file as text: ${path}`, error: 'binary_file' };

      const content = readFileSync(path, 'utf-8');
      const offset = typeof args.offset === 'number' ? Math.max(0, Math.floor(args.offset)) : 0;
      const maxChars = typeof args.maxChars === 'number'
        ? Math.max(1, Math.min(Math.floor(args.maxChars), 500_000))
        : DEFAULT_MAX_READ_CHARS;
      const slice = content.slice(offset, offset + maxChars);
      const truncated = offset + maxChars < content.length;
      return ok(slice + (truncated ? `\n\n[truncated at ${offset + maxChars}/${content.length} chars]` : ''), {
        path,
        length: content.length,
        offset,
        returnedChars: slice.length,
        truncated,
      });
    },
  },
  {
    name: 'file.search',
    title: 'Search Files',
    description: 'Search local text files for a literal string or regex pattern.',
    permission: 'read',
    timeoutMs: 30000,
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        pattern: { type: 'string' },
        regex: { type: 'boolean' },
        recursive: { type: 'boolean' },
        maxResults: { type: 'number' },
      },
      required: ['path', 'pattern'],
      additionalProperties: false,
    },
    cliExamples: ['file search C:/AI/project "TODO"'],
    handler: (args) => {
      const root = normalizePath(requireString(args, 'path'));
      const pattern = requireString(args, 'pattern');
      if (!existsSync(root)) return { ok: false, text: `Path not found: ${root}`, error: 'not_found' };
      const recursive = args.recursive !== false;
      const maxResults = typeof args.maxResults === 'number' ? Math.max(1, Math.min(args.maxResults, 500)) : DEFAULT_SEARCH_LIMIT;
      const files = statSync(root).isFile() ? [root] : walkFiles(root, { recursive, maxFiles: DEFAULT_FILE_LIMIT });
      const matcher = args.regex === true
        ? new RegExp(pattern, 'i')
        : null;
      const literal = pattern.toLowerCase();
      const results: Array<{ path: string; lineNumber: number; line: string }> = [];

      for (const file of files) {
        if (!isProbablyText(file)) continue;
        let content = '';
        try {
          content = readFileSync(file, 'utf-8');
        } catch {
          continue;
        }
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const matched = matcher ? matcher.test(line) : line.toLowerCase().includes(literal);
          if (!matched) continue;
          results.push({ path: file, lineNumber: i + 1, line: line.slice(0, 500) });
          if (results.length >= maxResults) break;
        }
        if (results.length >= maxResults) break;
      }

      if (results.length === 0) return ok(`No matches for "${pattern}".`, { results });
      const text = results.map(r => `${r.path}:${r.lineNumber}: ${r.line}`).join('\n');
      return ok(text, { results, truncated: results.length >= maxResults });
    },
  },
  {
    name: 'file.write',
    title: 'Write File',
    description: 'Write or append a local text file, creating parent folders if needed.',
    permission: 'write',
    timeoutMs: 10000,
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        mode: { type: 'string', enum: ['overwrite', 'append', 'create_new'] },
        backup: { type: 'boolean' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    cliExamples: ['file write C:/AI/project/note.md "content"'],
    handler: (args) => {
      const path = normalizePath(requireString(args, 'path'));
      const content = requireString(args, 'content');
      const mode = typeof args.mode === 'string' ? args.mode : 'overwrite';
      const backup = args.backup !== false;
      assertWritablePath(path);
      if (mode === 'create_new' && existsSync(path)) throw new Error(`File already exists: ${path}`);
      mkdirSync(dirname(path), { recursive: true });
      const backupPath = backup && existsSync(path) && mode !== 'append' ? backupFile(path) : null;
      if (mode === 'append') {
        const current = existsSync(path) ? readFileSync(path, 'utf-8') : '';
        writeFileSync(path, current + content, 'utf-8');
      } else {
        writeFileSync(path, content, 'utf-8');
      }
      return ok(`Wrote ${content.length} chars to ${path}${backupPath ? ` (backup: ${backupPath})` : ''}.`, { path, backupPath });
    },
  },
  {
    name: 'file.edit',
    title: 'Edit File',
    description: 'Edit a local text file by replacing exact text or a regex match. Creates a backup by default.',
    permission: 'write',
    timeoutMs: 10000,
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        search: { type: 'string' },
        replace: { type: 'string' },
        regex: { type: 'boolean' },
        all: { type: 'boolean' },
        expectedOccurrences: { type: 'number' },
        backup: { type: 'boolean' },
      },
      required: ['path', 'search', 'replace'],
      additionalProperties: false,
    },
    cliExamples: ['file edit C:/AI/project/file.md "old" "new"'],
    handler: (args) => {
      const path = normalizePath(requireString(args, 'path'));
      const search = requireString(args, 'search');
      const replace = typeof args.replace === 'string' ? args.replace : '';
      const backup = args.backup !== false;
      assertWritablePath(path);
      if (!existsSync(path)) return { ok: false, text: `Path not found: ${path}`, error: 'not_found' };
      if (!statSync(path).isFile()) return { ok: false, text: `Not a file: ${path}`, error: 'not_file' };
      if (!isProbablyText(path)) return { ok: false, text: `Refusing to edit likely-binary file: ${path}`, error: 'binary_file' };

      const original = readFileSync(path, 'utf-8');
      const all = args.all === true;
      let next = original;
      let occurrences = 0;

      if (args.regex === true) {
        const flags = all ? 'g' : '';
        const re = new RegExp(search, flags);
        next = original.replace(re, () => {
          occurrences += 1;
          return replace;
        });
      } else {
        const parts = original.split(search);
        occurrences = parts.length - 1;
        if (occurrences > 0) {
          next = all
            ? parts.join(replace)
            : original.replace(search, replace);
          if (!all) occurrences = 1;
        }
      }

      if (occurrences === 0) throw new Error(`Search text not found in ${path}`);
      if (typeof args.expectedOccurrences === 'number' && occurrences !== args.expectedOccurrences) {
        throw new Error(`Expected ${args.expectedOccurrences} occurrence(s), found ${occurrences}. No changes written.`);
      }
      if (next === original) throw new Error('Edit produced no changes.');
      const backupPath = backup ? backupFile(path) : null;
      writeFileSync(path, next, 'utf-8');
      return ok(`Edited ${path}; replaced ${occurrences} occurrence(s)${backupPath ? ` (backup: ${backupPath})` : ''}.`, {
        path,
        occurrences,
        backupPath,
      });
    },
  },
];
