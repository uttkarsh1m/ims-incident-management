import { WorkItemState } from '../WorkItemState';
import { WorkItemStatus } from '../../../types';

export class ResolvedState implements WorkItemState {
  readonly status: WorkItemStatus = 'RESOLVED';

  canTransitionTo(next: WorkItemStatus): boolean {
    // Can only close if RCA is present — enforced at service layer
    return next === 'CLOSED';
  }

  getAllowedTransitions(): WorkItemStatus[] {
    return ['CLOSED'];
  }
}
