import { WorkItemState } from '../WorkItemState';
import { WorkItemStatus } from '../../../types';

export class ClosedState implements WorkItemState {
  readonly status: WorkItemStatus = 'CLOSED';

  canTransitionTo(_next: WorkItemStatus): boolean {
    // Terminal state — no further transitions allowed
    return false;
  }

  getAllowedTransitions(): WorkItemStatus[] {
    return [];
  }
}
