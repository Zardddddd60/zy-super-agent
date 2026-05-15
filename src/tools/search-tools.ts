import fg from 'fast-glob';
import { dirname, join, relative, resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

import type { ToolDefinition } from './registry';

type GlobInput = {
  pattern: string;
  path?: string;
};

export const globTool: ToolDefinition<GlobInput, string> = {
  name: 'glob',
  description: '按模式搜索文件。支持 * 和 ** 通配符，如 "src/**/*.ts" 匹配 src 下所有 TypeScript 文件',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: '搜索模式，如 "**/*.ts"、"src/*.json"',
      },
      path: {
        type: 'string',
        description: '搜索起始目录，默认当前目录'
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  },

  execute: async ({ pattern, path = '.' }) => {
    const result = await fg(pattern, {
      cwd: resolve(path),
      ignore: ['node_modules/**', '.git/**'],
      dot: false,
      onlyFiles: true,
      followSymbolicLinks: false,
    });
    if (result.length === 0) {
      return `没有找到匹配 "${pattern}" 的文件`;
    }
    return result.sort().join('\n');
  },

  isConcurrencySafe: true,
  isReadOnly: true,
};

type GrepInput = {
  pattern: string;
  path?: string;
};

export const grepTool: ToolDefinition<GrepInput, string> = {
  name: 'grep',
  description: '在文件中搜索匹配指定模式的内容。返回匹配的行号和内容',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: '搜索模式（正则表达式）',
      },
      path: {
        type: 'string',
        description: '搜索路径（文件或目录），默认当前目录',
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  },

  execute: async ({ pattern, path = '.' }) => {
    const baseDir = resolve(path);
    if (!existsSync(baseDir)) {
      return `路径不存在: ${baseDir}`;
    }
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'i');
    } catch (err) {
      return `非法的pattern: ${err}`;
    }
    const stat = statSync(baseDir);
    const resultRoot = stat.isFile() ? dirname(baseDir) : baseDir;
    const matches: string[] = [];
    const SKIP = new Set(['node_modules', '.git', 'dist']);
    const BIN_EXT = new Set(['.png', '.jpg', '.gif', '.woff', '.woff2', '.ico', '.lock']);

    function searchFile(filePath: string) {
      if (matches.length >= 50) {
        return;
      }
      const ext = filePath.slice(filePath.lastIndexOf('.'));
      if (BIN_EXT.has(ext)) {
        return;
      }
      let content: string;
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch {
        return;
      }

      const lines = content.split('\n');
      const rel = relative(resultRoot, filePath);
      for (let i = 0; i < lines.length; i ++) {
        const line = lines[i];
        if (regex.test(line)) {
          matches.push(`${rel}:${i+1}: ${lines[i].trimEnd()}`);
          if (matches.length >= 50) {
            return;
          }
        }
      }
    }

    function walk(dir: string) {
      if (matches.length >= 50) {
        return;
      }
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }

      for (const name of entries) {
        if (SKIP.has(name)) {
          continue;
        }
        const full = join(dir, name);
        try {
          const stat = statSync(full);
          if (stat.isFile()) {
            searchFile(full);
          } else {
            walk(full);
          }
        } catch {
          /* skip */
        }
      }
    }

    if (stat.isFile()) {
      searchFile(baseDir);
    } else {
      walk(baseDir);
    }

    if (matches.length === 0) {
      return `没有找到匹配 "${pattern}" 的内容`;
    }
    const suffix = matches.length >= 50
      ? `\n... (结果已截断，共 50+ 条匹配)`
      : '';
    return matches.join('\n') + suffix;
  },

  isConcurrencySafe: true,
  isReadOnly: true,
  maxResultChars: 3000,
};
