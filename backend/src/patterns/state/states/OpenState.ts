import { WorkItemState } from '../WorkItemState';
import { WorkItemStatus } from '../../../types';

export class OpenState implements WorkItemState {
  readonly status: WorkItemStatus = 'OPEN';

  canTransitionTo(next: WorkItemStatus): boolean {
    return next === 'INVESTIGATING';
  }

  getAllowedTransitions(): WorkItemStatus[] {
    return ['INVESTIGATING'];
  }
}
