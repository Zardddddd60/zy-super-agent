import { jsonSchema, type Tool, type JSONSchema7 } from 'ai';

// 使用自定义的tool，而不是ai的Tool，
// 包含了除了与模型交互的其他语义
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolDefinition<ExecuteParams = any, ExecuteResult = any> {
  // vercel sdk 需要的，只关心跟模型的交互，
  // 不处理并发安全，结果截断，权限等等
  name: string;
  description: string;
  parameters: JSONSchema7;
  execute: (input: ExecuteParams) => Promise<ExecuteResult>;

  // 给Agent loop做决策用的
  isConcurrencySafe?: boolean;
  isReadOnly?: boolean;
  maxResultChars?: number;
}

const DEFAULT_MAX_RESULT_CHARS = 3000;

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>;
  private concurrentCount = 0;
  private exclusiveLock = false;
  private waitQueue: Array<() => void> = [];

  register(...tools: ToolDefinition[]) {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  get(name: string) {
    return this.tools.get(name);
  }

  getAll() {
    return Array.from(this.tools.values());
  }

  /**
   * 把自定义的ToolDefinition转换成Vercel AI SDK的工具format
   * @returns AISDK format的Tool格式
   */
  toAISDKFormat() {
    const result: Record<string, Tool> = {};
    for (const [name, toolDef] of this.tools) {
      const {
        maxResultChars,
        execute: executeFn,
        parameters,
        description,
        isConcurrencySafe = false,
      } = toolDef;

      result[name] = {
        inputSchema: jsonSchema(parameters),
        description,
        execute: async (input) => {
          if (isConcurrencySafe) {
            await this.acquireConcurrent();
            console.log(`  [并发] ${name} 获取共享锁`);
          } else {
            await this.acquireExclusive();
            console.log(`  [串行] ${name} 获取独占锁，等待其他工具完成`);
          }
          try {
            const raw = await executeFn(input);
            const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
            return truncateResult(text, maxResultChars);
          } finally {
            if (isConcurrencySafe) {
              this.releaseConcurrent();
            } else {
              this.releaseExclusive();
            }
          }
        },
      };
    }

    return result;
  }

  private async acquireConcurrent() {
    while (this.exclusiveLock) {
      await new Promise<void>(r => this.waitQueue.push(r));
    }
    // 现在有多少个获取了同步锁
    this.concurrentCount ++;
  }
  private releaseConcurrent() {
    this.concurrentCount --;
    if (this.concurrentCount === 0) {
      this.drainQueue();
    }
  }

  private drainQueue() {
    const waitingList = this.waitQueue.splice(0);
    for (const resoleFn of waitingList) {
      resoleFn();
    }
  }

  private async acquireExclusive() {
    while (this.exclusiveLock || this.concurrentCount > 0) {
      await new Promise<void>(r => this.waitQueue.push(r));
    }
    this.exclusiveLock = true;
  }

  private releaseExclusive() {
    this.exclusiveLock = false;
    this.drainQueue();
  }
}


export function truncateResult(text: string, maxChars = DEFAULT_MAX_RESULT_CHARS) {
  if (text.length < maxChars) {
    return text;
  }

  const headSize = Math.floor(maxChars * 0.6);
  const tailSize = maxChars - headSize;
  // text中，maxChars的前60%
  const head = text.slice(0, headSize);
  // text中 maxChars的后40%
  const tail = text.slice(-tailSize);
  // 省略的是整体长度-保留长度
  const dropped = text.length - headSize - tailSize;
  return `${head}\n\n... [省略 ${dropped} 字符] ...\n\n${tail}`;
}
