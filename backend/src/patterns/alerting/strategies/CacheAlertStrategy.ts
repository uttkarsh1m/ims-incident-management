import { AlertStrategy } from '../AlertStrategy';
import { AlertPayload, SignalSeverity } from '../../../types';

/**
 * P2 Alert Strategy for Cache failures.
 * Cache failures degrade performance but are not immediately fatal.
 */
export class CacheAlertStrategy implements AlertStrategy {
  readonly name = 'CACHE_ALERT';
  readonly defaultSeverity: SignalSeverity = 'P2';

  async alert(payload: AlertPayload): Promise<void> {
    const contacts = this.getEscalationContacts();
    console.warn(
      `[ALERT][P2][CACHE] 🟡 CACHE DEGRADATION\n` +
        `  Work Item : ${payload.work_item_id}\n` +
        `  Component : ${payload.component_id}\n` +
        `  Message   : ${payload.message}\n` +
        `  Timestamp : ${payload.timestamp.toISOString()}\n` +
        `  Notifying : ${contacts.join(', ')}`
    );
  }

  getEscalationContacts(): string[] {
    return ['infra-team@company.com'];
  }
}
