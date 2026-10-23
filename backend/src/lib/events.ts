import { EventEmitter } from 'events';
/** In-process pub/sub used to push SSE updates. Swap for Redis pub/sub when scaling horizontally. */
export const bus = new EventEmitter();
bus.setMaxListeners(0); // one listener per SSE client; unbounded by design
export const emitRfqUpdate = (rfqId: string) => bus.emit('rfq', rfqId);
