import { CapabilityError, peekService, serviceAvailable } from './registry.js';

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

declare module './registry.js' {
  interface ServiceProviders {
    sensors: SensorsPort;
  }
}

/** Whether the host has a sensors service at all. */
export function sensorsAvailable(): boolean {
  return serviceAvailable('sensors') === 'available';
}

/** Whether this device has the sensor. */
export function sensorAvailable(type: SensorType): boolean {
  return peekService('sensors')?.available(type) ?? false;
}

/**
 * Watch a sensor through the host's `sensors` service (SensorManager /
 * CoreMotion on native hosts; `devicemotion` for accelerometer and gyroscope
 * on the web). Returns a disposer that stops the provider.
 */
export function watchSensor(
  type: SensorType,
  listener: (reading: SensorReading) => void,
): () => void {
  const port = peekService('sensors');
  if (!port) throw new CapabilityError(`sensor.${type}`);
  return port.watch(type, listener);
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
