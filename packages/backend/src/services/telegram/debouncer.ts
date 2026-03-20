// Telegram message debouncer — combines rapid messages from same chat

import type { Context } from 'telegraf';
import type { Update } from 'telegraf/types';

export interface TelegramQueuedMessage {
  content: string;
  ctx: Context<Update.MessageUpdate>;
  metadata: Record<string, any>;
  type: 'text' | 'voice' | 'photo' | 'audio' | 'document';
}

export interface TelegramBatch {
  messages: TelegramQueuedMessage[];
  chatId: string;
}

type BatchHandler = (batch: TelegramBatch) => Promise<void>;

const DEBOUNCE_MS = 2000;

export class TelegramDebouncer {
  private queue: TelegramQueuedMessage[] = [];
  private timer: NodeJS.Timeout | null = null;
  private chatId: string = '';
  private handler: BatchHandler | null = null;

  onBatch(handler: BatchHandler): void {
    this.handler = handler;
  }

  add(msg: TelegramQueuedMessage, chatId: string): void {
    this.chatId = chatId;
    this.queue.push(msg);

    if (this.timer) {
      clearTimeout(this.timer);
    }

    // Immediate flush for non-text messages (voice, photo, document)
    if (msg.type !== 'text') {
      this.flush();
      return;
    }

    this.timer = setTimeout(() => {
      this.flush();
    }, DEBOUNCE_MS);
  }

  private async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.queue.length === 0) return;

    const messages = [...this.queue];
    const chatId = this.chatId;
    this.queue = [];

    if (this.handler) {
      await this.handler({ messages, chatId });
    }
  }

  destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.queue = [];
  }
}
