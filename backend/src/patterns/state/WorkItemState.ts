import { WorkItemStatus } from '../../types';

/**
 * State Pattern: Each state knows which transitions are valid.
 */
export interface WorkItemState {
  readonly status: WorkItemStatus;
  canTransitionTo(next: WorkItemStatus): boolean;
  getAllowedTransitions(): WorkItemStatus[];
}
