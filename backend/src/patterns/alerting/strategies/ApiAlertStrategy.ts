import { AlertStrategy } from '../AlertStrategy';
import { AlertPayload, SignalSeverity } from '../../../types';

/**
 * P1 Alert Strategy for API failures.
 */
export class ApiAlertStrategy implements AlertStrategy {
  readonly name = 'API_ALERT';
  readonly defaultSeverity: SignalSeverity = 'P1';

  async alert(payload: AlertPayload): Promise<void> {
    const contacts = this.getEscalationContacts();
    console.warn(
      `[ALERT][P1][API] 🟠 API SERVICE FAILURE\n` +
        `  Work Item : ${payload.work_item_id}\n` +
        `  Component : ${payload.component_id}\n` +
        `  Message   : ${payload.message}\n` +
        `  Timestamp : ${payload.timestamp.toISOString()}\n` +
        `  Notifying : ${contacts.join(', ')}`
    );
  }

  getEscalationContacts(): string[] {
    return ['api-oncall@company.com', 'backend-lead@company.com'];
  }
}
