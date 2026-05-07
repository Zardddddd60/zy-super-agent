import { devToolsMiddleware } from '@ai-sdk/devtools';
import { createOpenAI } from '@ai-sdk/openai';
import 'dotenv/config';
import { createInterface } from 'node:readline';

import { agentLoop } from './agent-loop';
import { allTools } from './tools';
import { ToolRegistry } from './tool-registry';
import { MCPClient } from './mcp-client';

import { type ModelMessage, wrapLanguageModel } from 'ai';

const qwen = createOpenAI({
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.DASHSCOPE_API_KEY,
});

const model = wrapLanguageModel({
  model: qwen.chat('qwen-plus-latest'),
  middleware: devToolsMiddleware(),
});

const registry = new ToolRegistry();
registry.register(...allTools);

async function connectGithubMCP() {
  const githubToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

  if (githubToken) {
    console.log('\n连接 GitHub MCP Server...');
    try {
      const client = new MCPClient(
        'npx',
        ['-y', '@modelcontextprotocol/server-github'],
        {
          GITHUB_PERSONAL_ACCESS_TOKEN: githubToken,
        }
      );
  
      const tools = await registry.registerMCPServer('github', client);
      console.log(`   已注册${tools.length}个MCP工具`);
      return;
    } catch (err) {
      console.log(`  MCP 连接失败: ${err instanceof Error ? err.message : err}`);
    }
  }
}

async function main() {
  await connectGithubMCP();

  console.log(`\n已注册 ${registry.getAll().length} 个工具：`);
  for (const tool of registry.getAll()) {
    const isMCP = tool.name.startsWith('mcp__');
    const flags = [
      isMCP ? 'MCP' : '内置',
      tool.isConcurrencySafe ? '可并发' : '串行',
    ].join(', ');
    console.log(`  - ${tool.name}（${flags}）`);
  }

  const messages: ModelMessage[] = [];
  const rl = createInterface({
    // 本进程的stdin
    input: process.stdin,
    output: process.stdout,
  });

  const SYSTEM = `你是 Super Agent，一个有工具调用能力的 AI 助手。
你有内置工具和 MCP 工具可用。MCP 工具以 mcp__ 开头，如 mcp__github__list_issues。
需要查询 GitHub 信息时，使用 mcp__github__ 前缀的工具。
需要操作本地文件时，使用内置工具。
回答要简洁直接。`;

  function ask() {
    rl.question('\nYou: ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed === 'exit') {
        console.log('Bye!');
        await registry.closeAllMCP();
        rl.close();
        return;
      }

      messages.push({
        role: 'user',
        content: trimmed,
      });
      await agentLoop(model, registry, messages, SYSTEM);
      ask();
    });
  }

  console.log('\nSuper Agent v0.5 — MCP (type "exit" to quit)');
  console.log('试试："查看 vercel/ai 的 issues"、"搜索 MCP 相关的仓库"\n');
  ask();
}

main().catch(console.error);
