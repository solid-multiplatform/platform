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
export class EventEmitter {
    constructor() {
        /**
         * Lazily allocated on first `on`/`once` call. The vast majority of nodes in
         * a scene graph never have a listener attached, so deferring the map avoids
         * one object allocation per instance and keeps the hidden class smaller.
         * `null` means no listeners have ever been registered.
         */
        this.eventListeners = null;
    }
    on(event, listener) {
        let map = this.eventListeners;
        if (map === null) {
            map = this.eventListeners = {};
        }
        let listeners = map[event];
        if (listeners === undefined) {
            listeners = [];
            map[event] = listeners;
        }
        listeners.push(listener);
    }
    off(event, listener) {
        const map = this.eventListeners;
        if (map === null) {
            return;
        }
        const listeners = map[event];
        if (listeners === undefined) {
            return;
        }
        if (listener === undefined) {
            map[event] = undefined;
            return;
        }
        const index = listeners.indexOf(listener);
        if (index < 0) {
            return;
        }
        // One new array, without the listener (slice and splice would make
        // two: splice returns the removed elements in an array of their own).
        const next = [];
        for (let i = 0; i < listeners.length; i++) {
            if (i !== index) {
                next.push(listeners[i]);
            }
        }
        map[event] = next;
    }
    once(event, listener) {
        const onceListener = (target, data) => {
            this.off(event, onceListener);
            listener(target, data);
        };
        this.on(event, onceListener);
    }
    emit(event, data) {
        const map = this.eventListeners;
        if (map === null) {
            return;
        }
        const listeners = map[event];
        if (listeners === undefined) {
            return;
        }
        // off() replaces the array and on() appends past the length read here,
        // so a listener's on() or off() mid-emit (`once` always does) leaves
        // what this loop visits as it was: no copy, no allocation per emit.
        const len = listeners.length;
        for (let i = 0; i < len; i++) {
            listeners[i](this, data);
        }
    }
    /**
     * Whether a listener is registered for `event`. Lets a per-frame emitter
     * skip building a payload nobody will receive.
     */
    hasListener(event) {
        const map = this.eventListeners;
        if (map === null) {
            return false;
        }
        const listeners = map[event];
        return listeners !== undefined && listeners.length > 0;
    }
    /**
     * Whether any listener is currently registered for any event.
     *
     * @remarks
     * Used as a liveness signal: a `Texture` with no listeners has no
     * `CoreNode` (or `SubTexture`) subscribed to it.
     */
    hasListeners() {
        const map = this.eventListeners;
        if (map === null) {
            return false;
        }
        for (const event in map) {
            const listeners = map[event];
            if (listeners !== undefined && listeners.length > 0) {
                return true;
            }
        }
        return false;
    }
    removeAllListeners() {
        this.eventListeners = null;
    }
}
//# sourceMappingURL=EventEmitter.js.map