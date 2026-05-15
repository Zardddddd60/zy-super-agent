import { devToolsMiddleware } from '@ai-sdk/devtools';
import { createOpenAI } from '@ai-sdk/openai';
import 'dotenv/config';
import { createInterface } from 'node:readline';

import { agentLoop } from './agent/loop';
import { allTools } from './tools';
import { MCPClient } from './tools/mcp-client';

import { type ToolDefinition, ToolRegistry } from './tools/registry';
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

type ToolSearchInput = {
  query: string;
};

const toolSearchTool: ToolDefinition<ToolSearchInput> = {
  name: 'tool_search',
  description: '获取延迟工具的完整定义。传入工具名（从系统提示的延迟工具列表中选取），返回该工具的完整参数 Schema',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '工具名，如 "mcp__github__list_issues"。支持逗号分隔多个工具名',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  isConcurrencySafe: true,
  isReadOnly: true,
  execute: async ({ query }) => {
    const results = registry.searchTools(query);
    if (results.length === 0) {
      return `没有找到匹配 "${query}" 的工具`;
    }
    return results.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  },
};

registry.register(toolSearchTool);

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

  console.log(`\n已注册 ${registry.getActiveTools().length} 个工具：`);
  for (const tool of registry.getActiveTools()) {
    const isMCP = tool.name.startsWith('mcp__');
    const flags = [
      isMCP ? 'MCP' : '内置',
      tool.isConcurrencySafe ? '可并发' : '串行',
    ].join(', ');
    console.log(`  - ${tool.name}（${flags}）`);
  }

  const deferredSummary = registry.getDeferredToolSummary();

  const messages: ModelMessage[] = [];
  const rl = createInterface({
    // 本进程的stdin
    input: process.stdin,
    output: process.stdout,
  });

  const SYSTEM = `你是 Super Agent，一个有工具调用能力的 AI 助手。
你有内置工具和 MCP 工具可用。
如果你需要的工具不在当前列表中，使用 tool_search 工具搜索可用工具。
回答要简洁直接。${deferredSummary}`;

  console.log(SYSTEM);

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
