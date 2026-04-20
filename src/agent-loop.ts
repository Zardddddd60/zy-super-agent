import {
  streamText,
  type ModelMessage,
  type LanguageModel,
  type Tool,
} from 'ai';

const MAX_STEPS = 10;

export async function agentLoop(
  model: LanguageModel,
  tools: Record<string ,Tool>,
  messages: ModelMessage[],
  system: string,
) {
  let step = 0;
  while (step < MAX_STEPS) {
    step ++;
    console.log(`\n--- Step ${step} ---`);

    const result = streamText({
      model,
      system,
      tools,
      messages,
    });

    let hasToolCall = false;
    let isTextPrinted = false;
    let fullText = '';

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          process.stdout.write(part.text);
          fullText += part.text;
          isTextPrinted = true;
          break;
        case 'tool-call':
          hasToolCall = true;
          console.log(`  [调用: ${part.toolName}(${JSON.stringify(part.input)})]`);
          break;
        case 'tool-result':
          console.log(`  [结果: ${JSON.stringify(part.output)}]`);
          break;
      }
    }

    if (isTextPrinted) {
      console.log();
    }

    const stepMessages = await result.response;
    messages.push(...stepMessages.messages);

    if (!hasToolCall) {
      break;
    }

    console.log('  → 模型还在工作，继续下一步...');
  }
  if (step >= MAX_STEPS) {
    console.log('\n[达到最大步数限制，强制停止]');
  }
}
