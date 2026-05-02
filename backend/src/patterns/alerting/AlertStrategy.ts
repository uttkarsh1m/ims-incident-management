import { AlertPayload, SignalSeverity } from '../../types';

/**
 * Strategy Pattern: AlertStrategy interface.
 * Each component type implements its own alerting logic.
 */
export interface AlertStrategy {
  readonly name: string;
  readonly defaultSeverity: SignalSeverity;
  alert(payload: AlertPayload): Promise<void>;
  getEscalationContacts(): string[];
}
