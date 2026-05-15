import { execSync } from 'node:child_process';

import type { ToolDefinition } from './registry';

type BashInput = {
  command: string;
};

export const bashTool: ToolDefinition<BashInput, string> = {
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
