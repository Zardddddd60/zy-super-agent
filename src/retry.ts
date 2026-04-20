/**
 * 根据错误类型，决定哪些是值得重试的
 * @param error API报错
 * @returns 错误是否值得重试
 */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message || '';
  const statusMatch = message.match(/(\d{3})/);
  if (statusMatch) {
    const status = parseInt(statusMatch[1], 10);
    if ([429, 529, 408].includes(status)) {
      return true;
    }
    // 500服务端问题
    if (status > 500 && status < 600) {
      return true;
    }
    // 400大概率是客户端问题
    if (status < 500 && status > 400) {
      return false;
    }
  }

  if (message.includes('ECONNRESET') || message.includes('EPIPE')) return true;
  if (message.includes('ETIMEDOUT') || message.includes('timeout')) return true;
  if (message.includes('fetch failed') || message.includes('network')) return true;
  // AI SDK 会把流式错误包装成 NoOutputGeneratedError
  if (message.includes('No output generated')) return true;

  return false;
}

/**
 * 指数退避(exponential) + 随机抖动(jitter)
 * @param attempt
 * @param baseMs 
 * @param maxMs 
 */
export function calculateDelay(attempt: number, baseMs = 500, maxMs = 30000): number {
  const exponential = baseMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, maxMs);
  const jitterRange = capped * 0.25;
  const jittered = capped + (Math.random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(jittered));
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
