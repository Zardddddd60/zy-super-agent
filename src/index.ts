import { devToolsMiddleware } from '@ai-sdk/devtools';
import { createOpenAI } from '@ai-sdk/openai';
import 'dotenv/config';
import { createInterface } from 'node:readline';

import { agentLoop } from './agent-loop';
import { allTools } from './tools';
import { ToolRegistry } from './tool-registry';

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

console.log(`已注册 ${registry.getAll().length} 个工具：`);
for (const tool of registry.getAll()) {
  const flags = [
    tool.isConcurrencySafe ? '可并发' : '串行',
    tool.isReadOnly ? '只读' : '读写',
  ].join(', ');
  console.log(`  - ${tool.name}（${flags}）`);
}

const SYSTEM = `你是 Super Agent，一个有工具调用能力的 AI 助手。
需要查询信息时，主动使用工具，不要编造数据。
回答要简洁直接。`;

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

const messages: ModelMessage[] = [];

function ask() {
  rl.question('\nYou: ', async (input) => {
    const trimmed = input.trim();
    if (!trimmed || trimmed === 'exit') {
      console.log('Bye!');
      rl.close();
      return;
    }

    messages.push({
      role: 'user',
      content: trimmed,
    });

    try {
      await agentLoop(model, registry, messages, SYSTEM);
    } catch (e) {
      console.log('e>>>', e);
      process.exit(1);
    }
    ask();
  });
}

console.log('Super Agent v0.2 — Agent Loop (type "exit" to quit)\n');

ask();
