import { jsonSchema, type Tool, type JSONSchema7 } from 'ai';
import { MCPClient } from './mcp-client';

// 使用自定义的tool，而不是ai的Tool，
// 包含了除了与模型交互的其他语义
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
  shouldDefer?: boolean;
  searchHint?: string;
}

const DEFAULT_MAX_RESULT_CHARS = 3000;

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>;
  private concurrentCount = 0;
  private exclusiveLock = false;
  private waitQueue: Array<() => void> = [];
  private mcpClients: Array<MCPClient> = [];
  // 记录被tool_search发现的tool name
  private discoveredTools: Set<string> = new Set();

  register(...tools: ToolDefinition[]) {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  async registerMCPServer(serverName: string, client: MCPClient): Promise<string[]> {
    // 在register的过程中connect，返回后server可用
    await client.connect();
    this.mcpClients.push(client);

    const tools = await client.listTools();
    const registered: string[] = [];

    for (const tool of tools) {
      const prefixedName = `mcp__${serverName}__${tool.name}`;
      if (this.tools.has(prefixedName)) {
        continue;
      }

      this.register({
        name: prefixedName,
        description: `[MCP:${serverName}] ${tool.description}`,
        parameters: tool.inputSchema,
        // 大部分mcp都是read操作
        isConcurrencySafe: true,
        isReadOnly: true,
        maxResultChars: 3000,
        // mcp工具自动defer
        shouldDefer: true,
        searchHint: `${serverName} ${tool.name} ${tool.description}`,
        // 每个 MCP 工具的 execute 函数就是一个闭包，调用时通过 JSON-RPC 转发给 Server。
        execute: async (input: any) => {
          return client.callTool(tool.name, input);
        },
      });

      registered.push(prefixedName);
    }

    return registered;
  }

  async closeAllMCP() {
    for (const client of this.mcpClients) {
      await client.close();
    }
    this.mcpClients = [];
  }

  get(name: string) {
    return this.tools.get(name);
  }

  getAll() {
    return Array.from(this.tools.values());
  }

  public searchTools(query: string) {
    const q = query.trim();
    const names = q.includes(',')
      ? q.split(',').map((toolName) => toolName.trim()).filter(Boolean)
      : [q];

    const results: ToolDefinition[] = [];
    for (const name of names) {
      // tool search使用精确匹配
      const tool = this.tools.get(name);
      if (tool && tool.name !== 'tool_search') {
        results.push(tool!);
        this.discoveredTools.add(tool?.name);
      }
    }
    return results;
  }

  /**
   * 把自定义的ToolDefinition转换成Vercel AI SDK的工具format
   * @returns AISDK format的Tool格式
   */
  toAISDKFormat() {
    const result: Record<string, Tool> = {};
    const activeTools = this.getActiveTools();

    for (const toolDefinition of activeTools) {
      const {
        name,
        maxResultChars,
        execute: executeFn,
        parameters,
        description,
        isConcurrencySafe = false,
      } = toolDefinition;

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

  getActiveTools() {
    return this.getAll().filter(toolDefinition => {
      return !(toolDefinition.shouldDefer && !this.discoveredTools.has(toolDefinition.name));
    });
  }

  getDeferredToolSummary() {
    const deferred = this.getActiveTools();
    if (deferred.length === 0) {
      return '';
    }

    const lines = deferred.map(toolDefinition => {
      const hint = toolDefinition.searchHint ? ` - ${toolDefinition.searchHint}` : '';
      return `  - ${toolDefinition.name}${hint}`;
    });

    return `\n以下工具可用，但需要先通过 tool_search 搜索获取完整定义：\n${lines.join('\n')}`;
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
