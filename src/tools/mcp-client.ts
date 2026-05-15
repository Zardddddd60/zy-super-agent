import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as RlInterface } from 'node:readline';

interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface MCPCallResult {
  content: Array<{ type: string; text?: string; }>
  isError?: boolean;
}

/**
 * 1. spawn一个进程，通过stdio的方式实现主进程和子进程的通信；
 * 2. 主进程stdout通过readline获取子进程输出的数据，输出数据遵循协议规范；
 * 3. 三次握手初始化；
 * 4. mcp进程通过stdin或者用户调用，处理完之后按照2的方式输出数据；
 * 5. mcp中的tools是一种特殊的tool（还是tool），execute方法就是透传方法+参数到mcp进程内；
 * 6. agent初始化mcp工具的时候，调用client.listTools获取server的签名，注册到ToolRegistry中。
 */
export class MCPClient {
  private process: ChildProcess | null = null;
  private rl: RlInterface | null = null;
  private requestId = 0;
  private pending = new Map<number, {
    resolve: (v: any) => void;
    reject: (e: Error) => void;
  }>();
  private serverName: string;

  constructor(
    private command: string,
    private args: string[],
    private env?: Record<string, string>,
  ) {
    this.serverName = args[args.length - 1].replace(/^@.*\//, '') || 'mcp-server';
  }

  async connect() {
    this.process = spawn(this.command, this.args, {
      stdio: 'pipe',
      env: {
        ...process.env,
        ...this.env,
      },
    });

    this.process.on('error', (err) => {
      console.error(`[MCP]进程启动失败: ${err.message}`);
    });
    this.process.stderr?.on('data', () => {});

    // 使用readline处理进程产生的输出
    this.rl = createInterface({ input: this.process.stdout! });

    // 进程往stdout吐结果，内容是规范的：{ id, error, result }
    this.rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const promise = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) {
            promise.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
          } else {
            promise.resolve(msg.result);
          }
        }
      } catch {
        /* ignore non-JSON lines */
      }
    });

    // step1: 告诉 MCP server：客户端支持的协议版本、能力、客户端信息
    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'super-agent',
        version: '0.5.0',
      },
    });

    // step2: 等 server 返回 initialize response，完成协议版本/能力协商。

    // step3: 按照 MCP lifecycle 规范，初始化成功后客户端必
    // 须发送这个 initialized notification；server 在收到它之前，不应该进入完整的正常交互状态
    this.process.stdin!.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }) + '\n');
  }

  private send(method: string, params?: any) {
    return new Promise<any>((resolve, reject) => {
      const id = ++ this.requestId;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, 1500);

      this.pending.set(id, {
        resolve(v: any) {
          clearTimeout(timeout);
          resolve(v);
        },
        reject(e: Error) {
          clearTimeout(timeout);
          reject(e);
        },
      });

      const msg = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      });

      // 按照规范，往进程里扔 id+method+params
      this.process?.stdin?.write(msg + '\n');
    });
  }

  async listTools(): Promise<MCPTool[]> {
    const result = await this.send('tools/list', {});
    return result.tools || [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result: MCPCallResult = await this.send('tools/call', {
      name,
      arguments: args,
    });
    return (result.content || [])
      .filter((c) => c.type === 'text' && c.text)
      .map(c => c.text!)
      .join('\n') || '(无返回内容)';
  }

  async close() {
    this.rl?.close();
    this.process?.kill();
  }
}
