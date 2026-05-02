import { AlertStrategy } from '../AlertStrategy';
import { AlertPayload, SignalSeverity } from '../../../types';

/**
 * P1 Alert Strategy for Async Queue failures.
 */
export class AsyncQueueAlertStrategy implements AlertStrategy {
  readonly name = 'ASYNC_QUEUE_ALERT';
  readonly defaultSeverity: SignalSeverity = 'P1';

  async alert(payload: AlertPayload): Promise<void> {
    const contacts = this.getEscalationContacts();
    console.warn(
      `[ALERT][P1][ASYNC_QUEUE] 🟠 QUEUE FAILURE\n` +
        `  Work Item : ${payload.work_item_id}\n` +
        `  Component : ${payload.component_id}\n` +
        `  Message   : ${payload.message}\n` +
        `  Timestamp : ${payload.timestamp.toISOString()}\n` +
        `  Notifying : ${contacts.join(', ')}`
    );
  }

  getEscalationContacts(): string[] {
    return ['messaging-team@company.com', 'platform-oncall@company.com'];
  }
}
