import type { IEventEmitter } from './IEventEmitter.js';
/**
 * EventEmitter base class.
 *
 * `off` replaces an event's listener array rather than splice it, and
 * `on` appends to it, so an emit iterates the array it read, up to the
 * length it read, without copying it: a listener that removes itself or
 * another cannot disturb the loop, one added mid-emit runs from the next
 * emit, and emitting allocates nothing whatever the number of listeners
 * (`frameTick` fires on every frame).
 */
export declare class EventEmitter implements IEventEmitter {
    /**
     * Lazily allocated on first `on`/`once` call. The vast majority of nodes in
     * a scene graph never have a listener attached, so deferring the map avoids
     * one object allocation per instance and keeps the hidden class smaller.
     * `null` means no listeners have ever been registered.
     */
    private eventListeners;
    on(event: string, listener: (target: any, data: any) => void): void;
    off(event: string, listener?: (target: any, data: any) => void): void;
    once(event: string, listener: (target: any, data: any) => void): void;
    emit(event: string, data?: any): void;
    /**
     * Whether a listener is registered for `event`. Lets a per-frame emitter
     * skip building a payload nobody will receive.
     */
    hasListener(event: string): boolean;
    /**
     * Whether any listener is currently registered for any event.
     *
     * @remarks
     * Used as a liveness signal: a `Texture` with no listeners has no
     * `CoreNode` (or `SubTexture`) subscribed to it.
     */
    hasListeners(): boolean;
    removeAllListeners(): void;
}
