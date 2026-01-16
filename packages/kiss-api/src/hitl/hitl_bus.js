import { EventEmitter } from "events";

/**
 * In-process event bus for HITL flows.
 * For horizontal scaling, replace with Redis Pub/Sub or Postgres LISTEN/NOTIFY.
 */
export const hitlBus = new EventEmitter();
hitlBus.setMaxListeners(1000);
