import { AlertStrategy } from '../AlertStrategy';
import { AlertPayload, SignalSeverity } from '../../../types';

/**
 * P1 Alert Strategy for MCP Host failures.
 */
export class McpHostAlertStrategy implements AlertStrategy {
  readonly name = 'MCP_HOST_ALERT';
  readonly defaultSeverity: SignalSeverity = 'P1';

  async alert(payload: AlertPayload): Promise<void> {
    const contacts = this.getEscalationContacts();
    console.warn(
      `[ALERT][P1][MCP_HOST] 🟠 MCP HOST FAILURE\n` +
        `  Work Item : ${payload.work_item_id}\n` +
        `  Component : ${payload.component_id}\n` +
        `  Message   : ${payload.message}\n` +
        `  Timestamp : ${payload.timestamp.toISOString()}\n` +
        `  Notifying : ${contacts.join(', ')}`
    );
  }

  getEscalationContacts(): string[] {
    return ['platform-oncall@company.com', 'mcp-team@company.com'];
  }
}
