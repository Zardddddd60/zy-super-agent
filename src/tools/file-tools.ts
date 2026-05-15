import { join, resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

import type { ToolDefinition } from './registry';

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