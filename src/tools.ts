import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import fg from 'fast-glob';

import type { ToolDefinition } from './tool-registry';
import { execSync } from 'node:child_process';

type WeatherInput = {
  city: string;
};

export const weatherTool: ToolDefinition<WeatherInput, string> = {
  name: 'get_weather',
  description: '查询指定城市的天气信息',
  parameters: {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description: '城市名称，如"北京"、"上海"',
      },
    },
    required: ['city'],
    additionalProperties: false,
  },

  isConcurrencySafe: true,
  isReadOnly: true,
  execute: async ({ city }) => {
    const data: Record<string, string> = {
      '北京': '晴，15-25°C，东南风 2 级',
      '上海': '多云，18-22°C，西南风 3 级',
      '深圳': '阵雨，22-28°C，南风 2 级',
    };
    return data[city] || `${city}：暂无数据`;
  },
};

type CalculatorInput = {
  expression: string;
};

export const calculatorTool: ToolDefinition<CalculatorInput, string> = {
  name: 'calculator',
  description:  '计算数学表达式的结果。当用户提问涉及数学运算时使用',
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: '数学表达式，如 "2 + 3 * 4"' },
    },
    required: ['expression'],
    additionalProperties: false,
  },
  execute: async ({ expression }) => {
    try {
      // 生产环境不要用 eval，这里纯粹为了演示
      const result = new Function(`return ${expression}`)();
      return `${expression} = ${result}`;
    } catch {
      return `无法计算: ${expression}`;
    }
  },
};

type ReadFileInput = {
  path: string;
}

export const readFileTool: ToolDefinition<ReadFileInput, string> = {
  name: 'read_file',
  description: '读取指定路径的文件内容',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  execute: async ({ path }) => {
    return readFileSync(resolve(path), 'utf-8');
  },

  isConcurrencySafe: true,
  isReadOnly: true,
  maxResultChars: 500,
};

type WriteFileInput = {
  path: string;
  content: string;
};

export const writeFileTool: ToolDefinition<WriteFileInput, string> = {
  name: 'write_tool',
  description: '写入内容到指定文件',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径',
      },
      content: {
        type: 'string',
        description: '要写入的内容',
      },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  execute: async ({ path, content }) => {
    writeFileSync(resolve(path), content);
    return `已写入 ${content.length} 字符到 ${path}`;
  },

  isConcurrencySafe: false,
  isReadOnly: false,
  // 测试
  maxResultChars: 500,
};

type ListDirectoryInput = {
  path: string;
}

export const listDirectoryTool: ToolDefinition<ListDirectoryInput, string> = {
  name: 'list_directory',
  description: '列出指定目录下的文件和子目录',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '目录路径，默认为当前目录'
      },
    },
    required: [],
    additionalProperties: false,
  },
  execute: async ({ path = '' }) => {
    const resolved = resolve(path);
    return readdirSync(resolved).map(name => {
      const stat = statSync(join(resolved, name));
      return `${stat.isDirectory() ? '[DIR]' : '[FILE]'} ${name}`;
    }).join('\n');
  },

  isConcurrencySafe: true,
  isReadOnly: true,
};

type EditFileInput = {
  path: string;
  old_string: string;
  new_string: string;
};

export const editFileTool: ToolDefinition<EditFileInput, string> = {
  name: 'edit_file',
  description: '精确替换文件中的指定内容。用 old_string 定位要替换的文本，用 new_string 替换它。不是全量覆写——只改你指定的部分',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径',
      },
      old_string: {
        type: 'string',
        description: '要被替换的原始文本（必须精确匹配）',
      },
      new_string: {
        type: 'string',
        description: '替换后的新文本',
      },
    },
    required: ['path', 'old_string', 'new_string'],
    additionalProperties: false,
  },

  execute: async ({ path, old_string, new_string }) => {
    if (old_string.length === 0) {
      return 'old_string 不能为空';
    }
    const resolved = resolve(path);
    if (!existsSync(resolved)) {
      return `文件不存在: ${path}`;
    }

    const content = readFileSync(resolved, 'utf-8');
    const count = content.split(old_string).length - 1;

    if (count === 0) {
      return `未找到匹配内容。请检查 old_string 是否与文件中的文本完全一致（包括空格和换行）`;
    }

    if (count > 1) {
      return `找到 ${count} 处匹配，请提供更多上下文让 old_string 唯一`;
    }

    const updated = content.replace(old_string, new_string);
    writeFileSync(resolved, updated, 'utf-8');
    return `已替换 ${path} 中的内容（${old_string.length} → ${new_string.length} 字符）`;
  },

  isConcurrencySafe: false,
  isReadOnly: false,
};

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

type BashInput = {
  command: string;
};

export const BashTool: ToolDefinition<BashInput, string> = {
  name: 'bash',
  description: '执行 shell 命令并返回输出。适合运行脚本、检查环境、执行构建等操作',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: '要执行的 shell 命令',
      },
    },
    required: ['command'],
    additionalProperties: false,
  },

  execute: async ({ command }) => {
    // 环境检测，bash命令不可用的环境
    try {
      execSync('echo test', { stdio: 'ignore' });
    } catch {
      return `[bash 不可用] 当前环境（WebContainer）不支持 shell 命令`;
    }
    try {
      const output = execSync(command, {
        encoding: 'utf-8',
        // 超时 10 秒
        timeout: 10000,
        maxBuffer: 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output || '(命令执行成功，无输出)';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch(err: any) {
      const stderr = err.stderr || '';
      const stdout = err.stdout || '';
      return `命令执行失败 (exit ${err.status || 1}):\n${stderr || stdout || err.message}`;
    }
  },

  // 暂时注册成比较“危险”的工具
  isConcurrencySafe: false,
  isReadOnly: false,
  maxResultChars: 3000,
};

export const allTools: ToolDefinition[] = [
  weatherTool,
  calculatorTool,
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  editFileTool,
  globTool,
  grepTool,
  BashTool,
];
