import webpush from 'web-push';
import { listPushSubscriptions, removePushSubscription, touchPushSubscription } from './db.js';
import { registry } from './ws.js';

export interface PushPayload {
  title: string;
  body: string;
  threadId?: string;
  tag?: string;
  url?: string;
}

export class PushService {
  private configured = false;
  private vapidPublicKey: string | null = null;
  private enabled = true;
  private publicKeyEnv = 'VAPID_PUBLIC_KEY';
  private privateKeyEnv = 'VAPID_PRIVATE_KEY';
  private vapidContact = 'mailto:admin@example.com';

  constructor(options?: {
    enabled?: boolean;
    vapidPublic?: string;
    vapidPrivate?: string;
    vapidContact?: string;
    publicKeyEnv?: string;
    privateKeyEnv?: string;
  }) {
    this.enabled = options?.enabled ?? true;
    this.publicKeyEnv = options?.publicKeyEnv || this.publicKeyEnv;
    this.privateKeyEnv = options?.privateKeyEnv || this.privateKeyEnv;
    this.vapidContact = options?.vapidContact || this.vapidContact;

    const vapidPublic = options?.vapidPublic;
    const vapidPrivate = options?.vapidPrivate;
    const vapidContact = options?.vapidContact || this.vapidContact;

    if (!this.enabled) {
      console.log('PushService: disabled by config');
    } else if (vapidPublic && vapidPrivate && vapidContact) {
      webpush.setVapidDetails(vapidContact, vapidPublic, vapidPrivate);
      this.vapidPublicKey = vapidPublic;
      this.configured = true;
      console.log('PushService: VAPID configured');
    } else {
      console.log('PushService: VAPID keys not set — push disabled');
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  getVapidPublicKey(): string | null {
    return this.configured ? this.vapidPublicKey : null;
  }

  getConfigStatus() {
    return {
      enabled: this.enabled,
      configured: this.configured,
      hasPublicKey: !!this.vapidPublicKey,
      publicKeyEnv: this.publicKeyEnv,
      privateKeyEnv: this.privateKeyEnv,
      vapidContact: this.vapidContact,
    };
  }

  /** Send push to all web_push subscriptions */
  async sendPush(payload: PushPayload): Promise<void> {
    if (!this.configured) return;

    const subscriptions = listPushSubscriptions();
    if (subscriptions.length === 0) return;

    const jsonPayload = JSON.stringify(payload);

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        if (!sub.endpoint || !sub.keys_p256dh || !sub.keys_auth) return;

        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.keys_p256dh,
                auth: sub.keys_auth,
              },
            },
            jsonPayload
          );
          touchPushSubscription(sub.endpoint);
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 410 || statusCode === 404) {
            // Subscription expired or invalid — remove it
            console.log(`PushService: removing expired subscription ${sub.endpoint.slice(0, 50)}...`);
            removePushSubscription(sub.endpoint);
          } else {
            console.error(`PushService: failed to send to ${sub.endpoint.slice(0, 50)}...`, err);
          }
        }
      })
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    console.log(`PushService: sent ${sent}/${subscriptions.length} push notifications`);
  }

  /** Send push only when user has no active WebSocket connections */
  async sendIfOffline(payload: PushPayload): Promise<void> {
    if (!registry.isUserConnected()) {
      await this.sendPush(payload);
    }
  }

  /** Always send push regardless of connection state (for time-critical items) */
  async sendAlways(payload: PushPayload): Promise<void> {
    await this.sendPush(payload);
  }
}
