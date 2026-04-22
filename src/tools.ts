import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { ToolDefinition } from './tool-registry';

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

export const allTools: ToolDefinition[] = [
  weatherTool,
  calculatorTool,
  readFileTool,
  writeFileTool,
  listDirectoryTool,
];
