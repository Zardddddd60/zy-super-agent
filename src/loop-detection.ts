import { createHash } from 'node:crypto';

export interface ToolCallRecord {
  toolName: string;
  argsHash: string;
  resultHash?: string;
  timestamp: number;
}

export type DetectorKind =
  | 'generic_repeat'
  | 'ping_pong'
  | 'global_circuit_breaker';

export type DetectResult =
  | { stuck: false }
  | {
      stuck: true;
      level: 'warning' | 'critical';
      detector: DetectorKind;
      count: number;
      message: string;
    };

const HISTORY_SIZE = 30;
const WARNING_THRESHOLD = 5;
const CRITICAL_THRESHOLD = 10;
const BREAKER_THRESHOLD = 20;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const record = value as Record<string, unknown>;
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
}

function hash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export function hashToolCall(toolName: string, params: unknown): string {
  return `${toolName}:${hash(stableStringify(params))}`;
}

export function hashResult(result: unknown): string {
  return hash(stableStringify(result));
}

const history: ToolCallRecord[] = [];

export function recordCall(toolName: string, params: unknown) {
  history.push({
    toolName,
    argsHash: hashToolCall(toolName, params),
    timestamp: Date.now(),
  });

  if (history.length > HISTORY_SIZE) {
    history.shift();
  }
}

export function recordResult(
  toolName: string,
  params: unknown,
  result: unknown,
) {
  const argsHash = hashToolCall(toolName, params);
  const resultH = hashResult(result);

  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].toolName === toolName && history[i].argsHash === argsHash) {
      history[i].resultHash = resultH;
      break;
    }
  }
}

export function resetHistory() {
  history.length = 0;
}

function getNoProgressStreak(toolName: string, argsHash: string): number {
  let streak = 0;
  let lastResultHash: string | undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const historyItem = history[i];
    if (
      historyItem.toolName !== toolName ||
      historyItem.argsHash !== argsHash
    ) {
      continue;
    }
    if (!historyItem.resultHash) {
      continue;
    }
    // 这个时候，historyItem.toolName和argsHash和参数一直，且有resultHash
    if (!lastResultHash) {
      lastResultHash = historyItem.resultHash;
      streak = 1;
      continue;
    }
    if (historyItem.resultHash !== lastResultHash) {
      break;
    }
    streak++;
  }
  return streak;
}

/**
 * 找到history中的最后一条记录，以及倒数第2条记录
 *
 * @param currentHash
 * @returns
 */
function getPingPongCount(currentHash: string): number {
  if (history.length < 3) {
    return 0;
  }
  const last = history[history.length - 1];
  let otherHash: string | undefined;
  for (let i = history.length - 2; i >= 0; i--) {
    const historyItem = history[i];
    if (historyItem.argsHash !== last.argsHash) {
      otherHash = historyItem.argsHash;
      break;
    }
  }
  if (!otherHash) {
    return 0;
  }
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const expected = i % 2 === 0 ? last.argsHash : otherHash;
    if (history[i].argsHash !== expected) {
      break;
    }
    count++;
  }
  if (currentHash === otherHash && count >= 2) {
    return count + 1;
  }

  return 0;
}

export function detect(toolName: string, params: unknown): DetectResult {
  const argsHash = hashToolCall(toolName, params);
  const noProgressStreak = getNoProgressStreak(toolName, argsHash);

  if (noProgressStreak >= BREAKER_THRESHOLD) {
    return {
      stuck: true,
      level: 'critical',
      detector: 'global_circuit_breaker',
      count: noProgressStreak,
      message: `[熔断] ${toolName} 已重复 ${noProgressStreak} 次且无进展，强制停止`,
    };
  }

  const pingPongCount = getPingPongCount(argsHash);
  if (pingPongCount >= CRITICAL_THRESHOLD) {
    return {
      stuck: true,
      level: 'critical',
      detector: 'ping_pong',
      count: pingPongCount,
      message: `[熔断] 检测到乒乓循环（${pingPongCount} 次交替），强制停止`,
    };
  }

  if (pingPongCount >= WARNING_THRESHOLD) {
    return {
      stuck: true,
      level: 'warning',
      detector: 'ping_pong',
      count: pingPongCount,
      message: `[警告] 检测到乒乓循环（${pingPongCount} 次交替），建议换个思路`,
    };
  }

  const recentCount = history.filter(
    (h) => h.toolName === toolName && h.argsHash === argsHash,
  ).length;
  if (recentCount >= CRITICAL_THRESHOLD) {
    return {
      stuck: true,
      level: 'critical',
      detector: 'generic_repeat',
      count: recentCount,
      message: `[熔断] ${toolName} 相同参数已调用 ${recentCount} 次，强制停止`,
    };
  }

  if (recentCount >= WARNING_THRESHOLD) {
    return {
      stuck: true,
      level: 'warning',
      detector: 'generic_repeat',
      count: recentCount,
      message: `[警告] ${toolName} 相同参数已调用 ${recentCount} 次，你可能陷入了重复`,
    };
  }

  return {
    stuck: false,
  };
}
