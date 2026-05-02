import { WorkItemState } from '../WorkItemState';
import { WorkItemStatus } from '../../../types';

export class InvestigatingState implements WorkItemState {
  readonly status: WorkItemStatus = 'INVESTIGATING';

  canTransitionTo(next: WorkItemStatus): boolean {
    return next === 'RESOLVED';
  }

  getAllowedTransitions(): WorkItemStatus[] {
    return ['RESOLVED'];
  }
}
