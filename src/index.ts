import { devToolsMiddleware } from '@ai-sdk/devtools';
import { createOpenAI } from '@ai-sdk/openai';
import 'dotenv/config';
import { createInterface } from 'node:readline';

import { agentLoop } from './agent/loop';
import { allTools } from './tools';
import { MCPClient } from './tools/mcp-client';
import { SessionStore } from './session/store';

import { type ToolDefinition, ToolRegistry } from './tools/registry';
import { type ModelMessage, wrapLanguageModel } from 'ai';
import {
  coreRules,
  deferredTools,
  PromptBuilder,
  toolGuide,
  sessionContext,
  type PromptContext,
} from './context/prompt-builder';

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

  // const messages: ModelMessage[] = [];
  const isContinue = process.argv.includes('--continue');
  const sessionId = 'default';
  const store = new SessionStore(sessionId);

  let messages: ModelMessage[] = [];
  if (isContinue && store.exists()) {
    messages = store.load();
    console.log(`[Session] 恢复会话，${messages.length} 条历史消息`);
  } else {
    console.log(`[Session] 新会话`);
  }

  const builder = new PromptBuilder()
    .pipe('coreRules', coreRules())
    .pipe('toolGuide', toolGuide())
    .pipe('deferredTools', deferredTools())
    .pipe('sessionContext', sessionContext());

  const promptCtx: PromptContext = {
    toolCount: registry.getActiveTools().length,
    deferredToolSummary: registry.getDeferredToolSummary(),
    sessionMessageCount: messages.length,
    sessionId,
  };

  const rl = createInterface({
    // 本进程的stdin
    input: process.stdin,
    output: process.stdout,
  });

  const SYSTEM = builder.build(promptCtx);

  // Debug: 显示 Prompt Pipe 各模块状态
  builder.debug(promptCtx);

  function ask() {
    rl.question('\nYou: ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed === 'exit') {
        console.log('Bye!');
        await registry.closeAllMCP();
        rl.close();
        return;
      }

      const userMessage: ModelMessage = {
        role: 'user',
        content: trimmed,
      };
      messages.push(userMessage);
      store.append(userMessage);
      const beforeLen = messages.length;
      await agentLoop(model, registry, messages, SYSTEM);

      // 持久化本轮新增的消息（agent loop 会往 messages 里 push assistant/tool 消息）
      const newMessages = messages.slice(beforeLen);
      store.appendAll(newMessages);
      ask();
    });
  }

  console.log('\nSuper Agent v0.5 — MCP (type "exit" to quit)');
  console.log('试试："查看 vercel/ai 的 issues"、"搜索 MCP 相关的仓库"\n');
  ask();
}

main().catch(console.error);
