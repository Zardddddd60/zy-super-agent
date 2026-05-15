import type { ModelMessage } from 'ai';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SESSION_DIR = '.sessions';

export interface SessionEntry {
  type: 'message';
  timestamp: string;
  message: ModelMessage;
}

export class SessionStore {
  private dir: string;
  private sessionId: string;

  constructor(sessionId = 'default') {
    this.sessionId = sessionId;
    this.dir = SESSION_DIR;
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  append(message: ModelMessage) {
    const entry: SessionEntry = {
      type: 'message',
      timestamp: new Date().toISOString(),
      message,
    };
    appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf-8');
  }

  appendAll(messages: ModelMessage[]) {
    for (const message of messages) {
      this.append(message);
    }
  }

  load() {
    if (!this.exists()) {
      return [];
    }
    const content = readFileSync(this.filePath, 'utf-8').trim();
    if (!content) {
      return [];
    }

    const messages: ModelMessage[] = [];
    for (const line of content.split('\n')) {
      const trimmedLine = line.trim();
      if (trimmedLine) {
        try {
          const entry = JSON.parse(trimmedLine) as SessionEntry;
          if (entry.type === 'message') {
            messages.push(entry.message);
          }
        } catch {
          /* skip malformed lines */
        }
      }
    }

    return messages;
  }

  exists() {
    return existsSync(this.filePath);
  }

  private get filePath() {
    return join(this.dir, `${this.sessionId}.jsonl`);
  }
}
