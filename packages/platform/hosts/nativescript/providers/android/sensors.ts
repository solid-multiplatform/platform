import type {
  SensorReading,
  SensorsPort,
  SensorType,
} from '../../../../src/sdk/sensors.js';
import { mainHandler, type AndroidApp } from './runtime.js';

// android.hardware.Sensor.TYPE_*
const TYPES: Record<SensorType, number> = {
  accelerometer: 1,
  magnetometer: 2,
  gyroscope: 4,
  light: 5,
  barometer: 6,
  proximity: 8,
  'step-counter': 19,
};

const AXES = new Set<SensorType>([
  'accelerometer',
  'gyroscope',
  'magnetometer',
]);

/**
 * `SensorManager`. A sensor is powered only while something watches it: each
 * watch registers its own listener, delivered on the main looper at the UI
 * rate, and its disposer unregisters it. The step counter also needs the
 * `ACTIVITY_RECOGNITION` permission (Android 10 and later); without it the
 * system delivers no readings. Synchronous to construct.
 */
export function sensors(app: AndroidApp): SensorsPort {
  let service: android.hardware.SensorManager | undefined;
  const manager = (): android.hardware.SensorManager =>
    (service ??= app.context.getSystemService(
      android.content.Context.SENSOR_SERVICE,
    ) as android.hardware.SensorManager);
  return {
    available: (type) => manager().getDefaultSensor(TYPES[type]) !== null,
    watch(type, listener) {
      const sensor = manager().getDefaultSensor(TYPES[type]);
      if (!sensor) throw new Error('This device has no ' + type + ' sensor');
      const receiver = new android.hardware.SensorEventListener({
        onSensorChanged(event) {
          const values = event.values;
          const reading: SensorReading = {
            sensor: type,
            timestamp: Date.now(),
          };
          if (AXES.has(type)) {
            reading.x = values[0];
            reading.y = values[1];
            reading.z = values[2];
          } else reading.value = values[0];
          listener(reading);
        },
        onAccuracyChanged() {},
      });
      manager().registerListener(
        receiver,
        sensor,
        android.hardware.SensorManager.SENSOR_DELAY_UI,
        mainHandler(),
      );
      return () => manager().unregisterListener(receiver);
    },
  };
}
