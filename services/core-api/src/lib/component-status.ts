import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { makeEventRoutingKey, RABBITMQ_EXCHANGES } from '@scarline/contracts';
import type { ComponentId, HealthStatus } from '@scarline/contracts';
import type { RabbitManager } from './rabbit.js';

export interface ComponentState {
  componentId: ComponentId;
  componentName: string;
  status: HealthStatus;
  message?: string;
  checkedAt: string;
  metadata?: Record<string, unknown>;
}

export class ComponentRegistry {
  private readonly map = new Map<ComponentId, ComponentState>();

  upsert(state: ComponentState): void {
    this.map.set(state.componentId, state);
  }

  list(): ComponentState[] {
    return Array.from(this.map.values()).sort((left, right) => left.componentId.localeCompare(right.componentId));
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.list().map((item) => [item.componentId, item.status]));
  }

  async publish(
    rabbit: RabbitManager,
    logger: FastifyBaseLogger,
    state: ComponentState
  ): Promise<void> {
    this.upsert(state);
    try {
      await rabbit.publish(
        RABBITMQ_EXCHANGES.events,
        makeEventRoutingKey('system', 'global', 'system', 'component.status'),
        {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          routingKey: makeEventRoutingKey('system', 'global', 'system', 'component.status'),
          producer: 'core-api',
          type: 'event',
          payload: {
            componentId: state.componentId,
            componentName: state.componentName,
            status: state.status,
            message: state.message,
            checkedAt: state.checkedAt,
            metadata: state.metadata ?? {}
          },
          metadata: {
            studyId: null,
            runId: null,
            correlationId: null
          }
        }
      );
    } catch (error) {
      logger.error({ err: error }, 'failed to publish component status');
    }
  }
}
