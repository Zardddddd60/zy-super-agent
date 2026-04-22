import {
  type LanguageModel,
  type ModelMessage,
  streamText,
} from 'ai';
import { detect, recordCall, recordResult, resetHistory } from './loop-detection';
import { calculateDelay, isRetryable, sleep } from './retry';
import type { ToolRegistry } from './tool-registry';

const MAX_STEPS = 15;
const MAX_API_RETRIES = 3;
const TOKEN_BUDGET = 15000;

export async function agentLoop(
  model: LanguageModel,
  toolRegistry: ToolRegistry,
  messages: ModelMessage[],
  system: string,
) {
  let step = 0;
  resetHistory();
  let totalTokens = 0;
  while (step < MAX_STEPS) {
    step++;
    console.log(`\n--- Step ${step} ---`);

    let hasToolCall = false;
    let fullText = '';
    let shouldBreak = false;
    let lastToolCall: { name: string, input: unknown } | null = null;
    let stepResponse: Awaited<ReturnType<typeof streamText>['response']>;
    let stepUsage: Awaited<ReturnType<typeof streamText>['usage']>;

    for (let attempt = 1; ; attempt ++) {
      try {
        const result = streamText({
          model,
          system,
          tools: toolRegistry.toAISDKFormat(),
          messages,
          // 不自动重试
          maxRetries: 0,
          onError: () => {
            // console.log('onError>>>>', error.message);
          },
        });
        for await (const part of result.fullStream) {
          switch (part.type) {
            case 'text-delta':
              process.stdout.write(part.text);
              fullText += part.text;
              break;
            case 'tool-call': {
              hasToolCall = true;
              lastToolCall = {
                name: part.toolName,
                input: part.input,
              };
              console.log(
                `  [调用: ${part.toolName}(${JSON.stringify(part.input)})]`,
              );
  
              recordCall(part.toolName, part.input);
              const detectResult = detect(part.toolName, part.input);
              if (detectResult.stuck) {
                console.log(`  ${detectResult.message}`);
                if (detectResult.level === 'critical') {
                  shouldBreak = true;
                } else {
                  messages.push({
                    role: 'user' as const,
                    content: `[系统提醒] ${detectResult.message}。请换一个思路解决问题，不要重复同样的操作。`,
                  });
                }
              }
              
              break;
            }
            case 'tool-result':
              console.log(`  [结果: ${JSON.stringify(part.output)}]`);
              if (lastToolCall) {
                recordResult(lastToolCall.name, lastToolCall.input, part.output);
              }
              break;
          }
        }
        stepResponse = await result.response;
        stepUsage = await result.usage;
        // break调attempt的循环
        break;
      } catch (error) {
        if (attempt > MAX_API_RETRIES || !isRetryable(error)) {
          throw error;
        }
        const delay = calculateDelay(attempt);
        console.log(`  [重试] 第 ${attempt}/${MAX_API_RETRIES} 次失败，${delay}ms 后重试...`);
        await sleep(delay);
        hasToolCall = false;
        fullText = '';
        lastToolCall = null;
        shouldBreak = false;
      }
    }
    

    // 循环工具调用，break调整个loop
    if (shouldBreak) {
      console.log('\n[循环检测触发，Agent 已停止]');
      break;
    }

    messages.push(...stepResponse.messages);

    // Token 预算追踪
    const inp = stepUsage.inputTokens ?? 0;
    const out = stepUsage.outputTokens ?? 0;
    totalTokens += inp + out;
    const pct = Math.round(totalTokens / TOKEN_BUDGET * 100);
    console.log(`  [Token] ${totalTokens}/${TOKEN_BUDGET} (${pct}%)`);
    if (totalTokens > TOKEN_BUDGET) {
      console.log('\n[Token 预算耗尽，强制停止]');
      break;
    }

    if (!hasToolCall) {
      if (fullText) {
        console.log();
      }
      break;
    }

    console.log('  → 模型还在工作，继续下一步...');
  }
  if (step >= MAX_STEPS) {
    console.log('\n[达到最大步数限制，强制停止]');
  }
}
