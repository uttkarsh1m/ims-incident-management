import { AlertStrategy } from '../AlertStrategy';
import { AlertPayload, SignalSeverity } from '../../../types';

/**
 * P2 Alert Strategy for NoSQL store failures.
 */
export class NoSqlAlertStrategy implements AlertStrategy {
  readonly name = 'NOSQL_ALERT';
  readonly defaultSeverity: SignalSeverity = 'P2';

  async alert(payload: AlertPayload): Promise<void> {
    const contacts = this.getEscalationContacts();
    console.warn(
      `[ALERT][P2][NOSQL] 🟡 NOSQL STORE DEGRADATION\n` +
        `  Work Item : ${payload.work_item_id}\n` +
        `  Component : ${payload.component_id}\n` +
        `  Message   : ${payload.message}\n` +
        `  Timestamp : ${payload.timestamp.toISOString()}\n` +
        `  Notifying : ${contacts.join(', ')}`
    );
  }

  getEscalationContacts(): string[] {
    return ['data-team@company.com'];
  }
}
