import * as v from 'vitest';
import {
  contactsAvailable,
  getContacts,
  pickContact,
} from '../src/sdk/contacts.js';
import {
  calendarAvailable,
  createCalendarEvent,
  getCalendarEvents,
} from '../src/sdk/calendar.js';
import {
  readSensor,
  sensorAvailable,
  sensorsAvailable,
  watchSensor,
} from '../src/sdk/sensors.js';
import { mapsAvailable, openDirections, openMap } from '../src/sdk/maps.js';
import {
  checkForUpdate,
  createUpdateDelivery,
  updateSource,
  type UpdateInfo,
} from '../src/sdk/update.js';
import {
  createReleasePipeline,
  requireSigningIdentity,
  type ReleaseContext,
} from '../src/sdk/release.js';
import { CapabilityError } from '../src/sdk/registry.js';
import {
  expectIdleWebProviders,
  provide,
  useWebServices,
  withoutServices,
} from './services-helpers.js';
import { webServices } from '../src/hosts/web-services/index.js';

v.describe('contacts', () => {
  useWebServices();

  v.it('lists, searches and picks contacts through the host', async () => {
    const querySeen: unknown[] = [];
    const contact = {
      id: 'c1',
      displayName: 'Ada Lovelace',
      phones: [{ label: 'mobile', number: '+1555' }],
    };
    provide({
      contacts: {
        async list(query) {
          querySeen.push(query);
          return [contact];
        },
        async pick() {
          return contact;
        },
      },
    });
    v.expect(contactsAvailable()).toBe(true);
    v.expect(await getContacts({ search: 'Ada', limit: 5 })).toEqual([contact]);
    v.expect(querySeen).toEqual([{ search: 'Ada', limit: 5 }]);
    v.expect(await pickContact()).toEqual(contact);
  });

  v.it('returns undefined when the host has no picker', async () => {
    provide({ contacts: { list: async () => [] } });
    v.expect(await pickContact()).toBeUndefined();
  });

  v.it('throws a capability error without a contacts service', async () => {
    const check = async () => {
      v.expect(contactsAvailable()).toBe(false);
      await v.expect(getContacts()).rejects.toThrowError(CapabilityError);
      await v.expect(getContacts()).rejects.toThrowError(/contacts/);
      await v.expect(pickContact()).rejects.toThrowError(/contacts/);
    };
    // The browser has no contacts provider, so the web host is no different
    // from a host that installed nothing.
    v.expect(webServices.contacts).toBeUndefined();
    await check();
    await withoutServices(check);
  });
});

v.describe('calendar', () => {
  useWebServices();

  v.it('lists events by range and creates events', async () => {
    const drafted: unknown[] = [];
    provide({
      calendar: {
        async list(query) {
          return [
            {
              id: 'e1',
              title: 'Standup',
              start: query.start,
              end: query.start + 900_000,
            },
          ];
        },
        async create(event) {
          drafted.push(event);
          return { ...event, id: 'e2' };
        },
      },
    });
    v.expect(calendarAvailable()).toBe(true);
    const events = await getCalendarEvents({
      start: 1000,
      end: 2000,
      limit: 10,
    });
    v.expect(events[0]).toMatchObject({ id: 'e1', title: 'Standup' });
    v.expect(
      await createCalendarEvent({
        title: 'Review',
        start: 3000,
        end: 4000,
      }),
    ).toEqual({ title: 'Review', start: 3000, end: 4000, id: 'e2' });
    v.expect(drafted).toHaveLength(1);
  });

  v.it('validates range order and missing write support', async () => {
    provide({ calendar: { list: async () => [] } });
    await v
      .expect(getCalendarEvents({ start: 10, end: 5 }))
      .rejects.toThrowError(/after start/);
    await v
      .expect(createCalendarEvent({ title: 'x', start: 1, end: 2 }))
      .rejects.toThrowError(/calendar.create/);
  });

  v.it('throws a capability error without a calendar service', async () => {
    const check = async () => {
      v.expect(calendarAvailable()).toBe(false);
      await v
        .expect(getCalendarEvents({ start: 0, end: 1 }))
        .rejects.toThrowError(CapabilityError);
      await v
        .expect(createCalendarEvent({ title: 'x', start: 1, end: 2 }))
        .rejects.toMatchObject({ capability: 'calendar' });
    };
    v.expect(webServices.calendar).toBeUndefined();
    await check();
    await withoutServices(check);
  });
});

v.describe('sensors', () => {
  useWebServices();

  v.it('watches and reads a host sensor', async () => {
    let unsubscribed = 0;
    provide({
      sensors: {
        available: (type) => type === 'accelerometer',
        watch(type, listener) {
          listener({ sensor: type, x: 1, y: 2, z: 3, timestamp: 10 });
          return () => unsubscribed++;
        },
      },
    });
    v.expect(sensorsAvailable()).toBe(true);
    v.expect(sensorAvailable('accelerometer')).toBe(true);
    v.expect(sensorAvailable('barometer')).toBe(false);

    const readings: unknown[] = [];
    const stop = watchSensor('accelerometer', (reading) =>
      readings.push(reading),
    );
    v.expect(readings).toEqual([
      { sensor: 'accelerometer', x: 1, y: 2, z: 3, timestamp: 10 },
    ]);
    stop();
    v.expect(unsubscribed).toBe(1);

    const first = await readSensor('accelerometer');
    v.expect(first.x).toBe(1);
  });

  v.it('the web provider offers device motion and nothing else', () => {
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      'DeviceMotionEvent',
    );
    const listen = v.vi.spyOn(window, 'addEventListener');
    const unlisten = v.vi.spyOn(window, 'removeEventListener');
    try {
      Object.defineProperty(globalThis, 'DeviceMotionEvent', {
        configurable: true,
        value: undefined,
      });
      v.expect(sensorsAvailable()).toBe(true);
      v.expect(sensorAvailable('accelerometer')).toBe(false);
      v.expect(() => watchSensor('accelerometer', () => {})).toThrowError(
        /sensor.accelerometer/,
      );

      Object.defineProperty(globalThis, 'DeviceMotionEvent', {
        configurable: true,
        value: class extends Event {},
      });
      v.expect(sensorAvailable('accelerometer')).toBe(true);
      v.expect(sensorAvailable('gyroscope')).toBe(true);
      v.expect(sensorAvailable('barometer')).toBe(false);
      v.expect(() => watchSensor('barometer', () => {})).toThrowError(
        /sensor.barometer/,
      );
      v.expect(listen).not.toHaveBeenCalled();

      const readings: unknown[] = [];
      const stop = watchSensor('accelerometer', (reading) =>
        readings.push([reading.sensor, reading.x, reading.y, reading.z]),
      );
      const stopGyro = watchSensor('gyroscope', (reading) =>
        readings.push([reading.sensor, reading.x, reading.y, reading.z]),
      );
      const motion = Object.assign(new Event('devicemotion'), {
        accelerationIncludingGravity: { x: 1, y: 2, z: null },
        rotationRate: { alpha: 4, beta: 5, gamma: 6 },
      });
      window.dispatchEvent(motion);
      v.expect(readings).toEqual([
        ['accelerometer', 1, 2, undefined],
        ['gyroscope', 4, 5, 6],
      ]);
      stop();
      stopGyro();
      v.expect(unlisten.mock.calls.map((call) => call[0])).toEqual([
        'devicemotion',
        'devicemotion',
      ]);
      window.dispatchEvent(motion);
      v.expect(readings).toHaveLength(2);
    } finally {
      listen.mockRestore();
      unlisten.mockRestore();
      if (original)
        Object.defineProperty(globalThis, 'DeviceMotionEvent', original);
      else
        delete (globalThis as { DeviceMotionEvent?: unknown })
          .DeviceMotionEvent;
    }
  });

  v.it(
    'a host without a sensors service has no sensors and adds no listener',
    async () => {
      const listen = v.vi.spyOn(window, 'addEventListener');
      try {
        await withoutServices(() => {
          v.expect(sensorsAvailable()).toBe(false);
          v.expect(sensorAvailable('accelerometer')).toBe(false);
          v.expect(() => watchSensor('accelerometer', () => {})).toThrowError(
            CapabilityError,
          );
          v.expect(() => watchSensor('barometer', () => {})).toThrowError(
            /sensor.barometer/,
          );
        });
        v.expect(listen).not.toHaveBeenCalled();
      } finally {
        listen.mockRestore();
      }
    },
  );

  v.it(
    'the web provider is a plain object the registry reads synchronously',
    () => {
      expectIdleWebProviders({ eager: ['sensors'] });
    },
  );
});

v.describe('maps', () => {
  useWebServices();

  v.it('uses the host map provider and directions', async () => {
    const calls: unknown[] = [];
    provide({
      maps: {
        async open(options) {
          calls.push(['open', options]);
        },
        async directions(options) {
          calls.push(['directions', options]);
        },
      },
    });
    v.expect(mapsAvailable()).toBe(true);
    await openMap({
      center: { latitude: 51.5, longitude: -0.12 },
      zoom: 12,
    });
    await openDirections({
      origin: 'home',
      destination: { latitude: 48.85, longitude: 2.35 },
      mode: 'walking',
    });
    v.expect(calls).toEqual([
      ['open', { center: { latitude: 51.5, longitude: -0.12 }, zoom: 12 }],
      [
        'directions',
        {
          origin: 'home',
          destination: { latitude: 48.85, longitude: 2.35 },
          mode: 'walking',
        },
      ],
    ]);
  });

  v.it('falls back to Google Maps through the external opener', async () => {
    const opened: string[] = [];
    // The browser has no maps provider either: it opens the link.
    v.expect(webServices.maps).toBeUndefined();
    v.expect(mapsAvailable()).toBe(false);
    provide({
      openExternal: {
        open: async (url) => {
          opened.push(url);
        },
      },
    });
    await openMap({
      markers: [{ latitude: 1.25, longitude: 2.5, title: 'Here' }],
      zoom: 8,
    });
    await openDirections({
      destination: { latitude: 3, longitude: 4 },
      mode: 'transit',
    });
    v.expect(opened[0]).toContain('https://www.google.com/maps/search/');
    v.expect(opened[0]).toContain('query=1.25%2C2.5');
    v.expect(opened[0]).toContain('zoom=8');
    v.expect(opened[1]).toContain('https://www.google.com/maps/dir/');
    v.expect(opened[1]).toContain('destination=3%2C4');
    v.expect(opened[1]).toContain('travelmode=transit');
  });

  v.it(
    'a host with neither maps nor an external opener cannot open a map',
    async () => {
      const open = v.vi.spyOn(window, 'open');
      try {
        await withoutServices(async () => {
          v.expect(mapsAvailable()).toBe(false);
          await v
            .expect(openMap({ center: { latitude: 1, longitude: 2 } }))
            .rejects.toMatchObject({ capability: 'openExternal' });
          await v
            .expect(openDirections({ destination: 'home' }))
            .rejects.toThrowError(CapabilityError);
        });
        v.expect(open).not.toHaveBeenCalled();
      } finally {
        open.mockRestore();
      }
    },
  );
});

v.describe('update delivery', () => {
  useWebServices();

  const update: UpdateInfo = {
    version: '2.0.0',
    url: 'https://store.test/app',
  };

  v.it('downloads, installs and relaunches through the host', async () => {
    const calls: string[] = [];
    provide({
      updateDelivery: {
        async download(_update, onProgress) {
          calls.push('download');
          onProgress?.(0.25);
          onProgress?.(0.75);
        },
        async install() {
          calls.push('install');
        },
        async relaunch() {
          calls.push('relaunch');
        },
      },
    });
    const delivery = createUpdateDelivery();
    v.expect(delivery.applying()).toBe(false);
    v.expect(await delivery.apply(update)).toBe('installed');
    v.expect(calls).toEqual(['download', 'install', 'relaunch']);
    v.expect(delivery.applying()).toBe(false);

    // The progress signal is updated through the host callback.
    const next = createUpdateDelivery({
      async download(_update, onProgress) {
        onProgress?.(0.5);
      },
      async install() {},
    });
    await next.apply(update);
    v.expect(next.progress()).toBe(0.5);
  });

  v.it('opens the store URL without a delivery service', async () => {
    const opened: string[] = [];
    v.expect(webServices.updateDelivery).toBeUndefined();
    provide({
      openExternal: {
        open: async (url) => {
          opened.push(url);
        },
      },
    });
    const delivery = createUpdateDelivery();
    v.expect(await delivery.apply(update)).toBe('opened');
    v.expect(opened).toEqual(['https://store.test/app']);
    await v
      .expect(delivery.apply({ version: '2.0.0' }))
      .rejects.toThrowError(/updateDelivery/);
  });

  v.it(
    'a host with neither delivery nor an external opener cannot apply an update',
    async () => {
      const open = v.vi.spyOn(window, 'open');
      try {
        await withoutServices(async () => {
          const delivery = createUpdateDelivery();
          await v
            .expect(delivery.apply(update))
            .rejects.toMatchObject({ capability: 'openExternal' });
          await v
            .expect(delivery.apply({ version: '2.0.0' }))
            .rejects.toMatchObject({ capability: 'updateDelivery' });
          await v
            .expect(checkForUpdate('1.0.0'))
            .rejects.toMatchObject({ capability: 'updateSource' });
          v.expect(updateSource()).toBeUndefined();
        });
        v.expect(open).not.toHaveBeenCalled();
      } finally {
        open.mockRestore();
      }
    },
  );

  v.it(
    'checks the host update feed and offers only newer versions',
    async () => {
      const source = { check: async () => ({ version: '2.0.0' }) };
      provide({ updateSource: source });
      v.expect(updateSource()).toBe(source);
      v.expect(await checkForUpdate('1.0.0')).toEqual({ version: '2.0.0' });
      v.expect(await checkForUpdate('2.0.0')).toBeNull();
    },
  );
});

v.describe('release pipeline', () => {
  v.it('runs hooks in order and reports start/end/skip', async () => {
    const events: string[] = [];
    const context: ReleaseContext = {
      target: 'ios',
      version: '1.2.3',
      env: { APPLE_TEAM_ID: 'TEAM' },
    };
    const pipeline = createReleasePipeline(
      [
        {
          name: 'sign',
          run: (ctx) => events.push(`run:sign:${ctx.version}`),
        },
        {
          name: 'notarize',
          when: (ctx) => ctx.target === 'ios',
          run: async () => {
            events.push('run:notarize');
          },
        },
        {
          name: 'skip-me',
          when: () => false,
          run: () => events.push('run:skip'),
        },
      ],
      {
        onHook: (name, phase) => events.push(`${phase}:${name}`),
      },
    );
    v.expect(await pipeline.run(context)).toBe(context);
    v.expect(events).toEqual([
      'start:sign',
      'run:sign:1.2.3',
      'end:sign',
      'start:notarize',
      'run:notarize',
      'end:notarize',
      'skip:skip-me',
    ]);
  });

  v.it('stops on a failing hook and reports the error phase', async () => {
    const events: string[] = [];
    const pipeline = createReleasePipeline(
      [
        {
          name: 'sign',
          run: () => {
            throw new Error('no identity');
          },
        },
        {
          name: 'upload',
          run: () => events.push('upload'),
        },
      ],
      { onHook: (name, phase) => events.push(`${phase}:${name}`) },
    );
    await v
      .expect(pipeline.run({ target: 'android', version: '1.0.0' }))
      .rejects.toThrowError('no identity');
    v.expect(events).toEqual(['start:sign', 'error:sign']);
  });

  v.it(
    'requires signing identities from the context or environment',
    async () => {
      const missing = requireSigningIdentity('MISSING_SIGNING_KEY');
      await v
        .expect(
          createReleasePipeline([missing]).run({
            target: 'ios',
            version: '1.0.0',
            env: {},
          }),
        )
        .rejects.toThrowError(/MISSING_SIGNING_KEY/);

      const present = requireSigningIdentity('APPLE_TEAM_ID');
      await v
        .expect(
          createReleasePipeline([present]).run({
            target: 'ios',
            version: '1.0.0',
            env: { APPLE_TEAM_ID: 'TEAM' },
          }),
        )
        .resolves.toBeDefined();
    },
  );
});
