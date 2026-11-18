import { CapabilityError } from './services.js';

export type SensorType =
  | 'accelerometer'
  | 'gyroscope'
  | 'magnetometer'
  | 'barometer'
  | 'light'
  | 'proximity'
  | 'step-counter';

export interface SensorReading {
  sensor: SensorType;
  /** Acceleration/rotation/magnetic axes, when applicable. */
  x?: number;
  y?: number;
  z?: number;
  /** Scalar reading for barometer/light/proximity/step-counter. */
  value?: number;
  /** Unix milliseconds. */
  timestamp: number;
}

export interface SensorsPort {
  available(type: SensorType): boolean;
  watch(
    type: SensorType,
    listener: (reading: SensorReading) => void,
  ): () => void;
}

let port: SensorsPort | undefined;

export function setSensorsPort(next: SensorsPort | undefined): void {
  port = next;
}

export function sensorsAvailable(): boolean {
  return port !== undefined;
}

const deviceMotion = (): boolean =>
  typeof window !== 'undefined' && typeof DeviceMotionEvent !== 'undefined';

export function sensorAvailable(type: SensorType): boolean {
  if (port) return port.available(type);
  return (type === 'accelerometer' || type === 'gyroscope') && deviceMotion();
}

/**
 * Watch a sensor. Native hosts provide `SensorsPort` (SensorManager /
 * CoreMotion); the web fallback maps `devicemotion` for accelerometer and
 * gyroscope. Returns a disposer that stops the provider.
 */
export function watchSensor(
  type: SensorType,
  listener: (reading: SensorReading) => void,
): () => void {
  if (port) return port.watch(type, listener);
  if (!sensorAvailable(type) || typeof window === 'undefined') {
    throw new CapabilityError(`sensor.${type}`);
  }
  const handler = (event: DeviceMotionEvent) => {
    if (type === 'accelerometer') {
      const source = event.accelerationIncludingGravity;
      if (!source) return;
      listener({
        sensor: type,
        x: source.x ?? undefined,
        y: source.y ?? undefined,
        z: source.z ?? undefined,
        timestamp: Date.now(),
      });
      return;
    }
    const source = event.rotationRate;
    if (!source) return;
    listener({
      sensor: type,
      x: source.alpha ?? undefined,
      y: source.beta ?? undefined,
      z: source.gamma ?? undefined,
      timestamp: Date.now(),
    });
  };
  window.addEventListener('devicemotion', handler);
  return () => window.removeEventListener('devicemotion', handler);
}

/** Resolve with the first reading from a sensor. */
export function readSensor(type: SensorType): Promise<SensorReading> {
  return new Promise((resolve) => {
    const subscription: { stop?: () => void } = {};
    let done = false;
    const handler = (reading: SensorReading) => {
      if (done) return;
      done = true;
      subscription.stop?.();
      resolve(reading);
    };
    subscription.stop = watchSensor(type, handler);
    // Hosts may emit synchronously while the subscription is still being
    // assigned.
    if (done) subscription.stop();
  });
}
