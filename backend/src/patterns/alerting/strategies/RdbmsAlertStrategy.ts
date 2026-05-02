import { AlertStrategy } from '../AlertStrategy';
import { AlertPayload, SignalSeverity } from '../../../types';

/**
 * P0 Alert Strategy for RDBMS failures.
 * Database failures are critical — immediate escalation required.
 */
export class RdbmsAlertStrategy implements AlertStrategy {
  readonly name = 'RDBMS_ALERT';
  readonly defaultSeverity: SignalSeverity = 'P0';

  async alert(payload: AlertPayload): Promise<void> {
    const contacts = this.getEscalationContacts();
    console.error(
      `[ALERT][P0][RDBMS] 🔴 CRITICAL DATABASE FAILURE\n` +
        `  Work Item : ${payload.work_item_id}\n` +
        `  Component : ${payload.component_id}\n` +
        `  Message   : ${payload.message}\n` +
        `  Timestamp : ${payload.timestamp.toISOString()}\n` +
        `  Escalating to: ${contacts.join(', ')}`
    );
    // In production: integrate PagerDuty / OpsGenie / SNS here
  }

  getEscalationContacts(): string[] {
    return ['dba-oncall@company.com', 'platform-lead@company.com', 'cto@company.com'];
  }
}
