import { AlertStrategy } from './AlertStrategy';
import { AlertPayload, ComponentType } from '../../types';
import { RdbmsAlertStrategy } from './strategies/RdbmsAlertStrategy';
import { ApiAlertStrategy } from './strategies/ApiAlertStrategy';
import { CacheAlertStrategy } from './strategies/CacheAlertStrategy';
import { McpHostAlertStrategy } from './strategies/McpHostAlertStrategy';
import { AsyncQueueAlertStrategy } from './strategies/AsyncQueueAlertStrategy';
import { NoSqlAlertStrategy } from './strategies/NoSqlAlertStrategy';
import { confirmAlertDelivered } from '../../db/redis';

/**
 * Strategy Pattern: AlertContext selects and executes the correct alert strategy
 * based on the component type. Strategies can be swapped at runtime.
 */
export class AlertContext {
  private static readonly strategyMap: Map<ComponentType, AlertStrategy> = new Map([
    ['RDBMS',       new RdbmsAlertStrategy()],
    ['API',         new ApiAlertStrategy()],
    ['CACHE',       new CacheAlertStrategy()],
    ['MCP_HOST',    new McpHostAlertStrategy()],
    ['ASYNC_QUEUE', new AsyncQueueAlertStrategy()],
    ['NOSQL',       new NoSqlAlertStrategy()],
  ]);

  /**
   * Execute the alert strategy and confirm delivery atomically.
   *
   * confirmAlertDelivered is called immediately after strategy.alert() resolves,
   * inside this method — not in the caller. This minimises the crash window to
   * the gap between the final byte sent to the external system and the Redis SET,
   * which is microseconds rather than the full job execution time.
   *
   * If the process crashes in that microsecond gap, the pending TTL expires and
   * the next retry re-fires the alert. This is the irreducible minimum window
   * for at-least-once delivery across two systems (two-generals problem).
   * Exactly-once delivery to an external webhook is not achievable.
   */
  static async executeAlert(
    componentType: ComponentType,
    payload: AlertPayload
  ): Promise<void> {
    const strategy = this.strategyMap.get(componentType);
    if (!strategy) {
      console.warn(`[AlertContext] No strategy found for component type: ${componentType}`);
      return;
    }

    // Dispatch the alert via the strategy
    await strategy.alert(payload);

    // Confirm delivery immediately after dispatch succeeds.
    // Crash window is now: strategy.alert() last byte sent → this SET.
    // That window is irreducible without a two-phase commit to the external system.
    await confirmAlertDelivered(payload.work_item_id);
  }

  /**
   * Register or replace a strategy at runtime (open/closed principle).
   */
  static registerStrategy(componentType: ComponentType, strategy: AlertStrategy): void {
    this.strategyMap.set(componentType, strategy);
  }

  static getStrategy(componentType: ComponentType): AlertStrategy | undefined {
    return this.strategyMap.get(componentType);
  }
}
