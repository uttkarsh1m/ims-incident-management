import { WorkItemState } from './WorkItemState';
import { WorkItemStatus } from '../../types';
import { OpenState } from './states/OpenState';
import { InvestigatingState } from './states/InvestigatingState';
import { ResolvedState } from './states/ResolvedState';
import { ClosedState } from './states/ClosedState';

/**
 * State Pattern: WorkItemStateMachine manages valid lifecycle transitions.
 * Prevents illegal state jumps (e.g., OPEN → CLOSED directly).
 */
export class WorkItemStateMachine {
  private static readonly stateMap: Map<WorkItemStatus, WorkItemState> = new Map([
    ['OPEN',          new OpenState()],
    ['INVESTIGATING', new InvestigatingState()],
    ['RESOLVED',      new ResolvedState()],
    ['CLOSED',        new ClosedState()],
  ]);

  static getState(status: WorkItemStatus): WorkItemState {
    const state = this.stateMap.get(status);
    if (!state) {
      throw new Error(`Unknown work item status: ${status}`);
    }
    return state;
  }

  /**
   * Validate a transition. Throws if invalid.
   */
  static validateTransition(
    currentStatus: WorkItemStatus,
    nextStatus: WorkItemStatus
  ): void {
    const currentState = this.getState(currentStatus);
    if (!currentState.canTransitionTo(nextStatus)) {
      throw new Error(
        `Invalid transition: ${currentStatus} → ${nextStatus}. ` +
          `Allowed: [${currentState.getAllowedTransitions().join(', ')}]`
      );
    }
  }

  static getAllowedTransitions(status: WorkItemStatus): WorkItemStatus[] {
    return this.getState(status).getAllowedTransitions();
  }
}
