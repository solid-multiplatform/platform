import * as v from 'vitest';
import {
  contactsAvailable,
  getContacts,
  pickContact,
  setContactsPort,
} from '../src/sdk/contacts.js';
import {
  calendarAvailable,
  createCalendarEvent,
  getCalendarEvents,
  setCalendarPort,
} from '../src/sdk/calendar.js';
import {
  readSensor,
  sensorAvailable,
  sensorsAvailable,
  setSensorsPort,
  watchSensor,
} from '../src/sdk/sensors.js';
import {
  mapsAvailable,
  openDirections,
  openMap,
  setMapsPort,
} from '../src/sdk/maps.js';
import {
  createUpdateDelivery,
  setUpdateDeliveryPort,
  type UpdateInfo,
} from '../src/sdk/update.js';
import {
  createReleasePipeline,
  requireSigningIdentity,
  type ReleaseContext,
} from '../src/sdk/release.js';
import { resetDevicePorts, setDevicePorts } from '../src/sdk/device.js';

v.describe('contacts', () => {
  v.afterEach(() => setContactsPort(undefined));

  v.it('lists, searches and picks contacts through the host', async () => {
    const querySeen: unknown[] = [];
    const contact = {
      id: 'c1',
      displayName: 'Ada Lovelace',
      phones: [{ label: 'mobile', number: '+1555' }],
    };
    setContactsPort({
      async list(query) {
        querySeen.push(query);
        return [contact];
      },
      async pick() {
        return contact;
      },
    });
    v.expect(contactsAvailable()).toBe(true);
    v.expect(await getContacts({ search: 'Ada', limit: 5 })).toEqual([contact]);
    v.expect(querySeen).toEqual([{ search: 'Ada', limit: 5 }]);
    v.expect(await pickContact()).toEqual(contact);
  });

  v.it('returns undefined when the host has no picker', async () => {
    setContactsPort({ list: async () => [] });
    v.expect(await pickContact()).toBeUndefined();
  });

  v.it('throws a capability error without a contacts port', async () => {
    v.expect(contactsAvailable()).toBe(false);
    await v.expect(getContacts()).rejects.toThrowError(/contacts/);
    await v.expect(pickContact()).rejects.toThrowError(/contacts/);
  });
});

v.describe('calendar', () => {
  v.afterEach(() => setCalendarPort(undefined));

  v.it('lists events by range and creates events', async () => {
    const drafted: unknown[] = [];
    setCalendarPort({
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
    setCalendarPort({ list: async () => [] });
    await v
      .expect(getCalendarEvents({ start: 10, end: 5 }))
      .rejects.toThrowError(/after start/);
    await v
      .expect(createCalendarEvent({ title: 'x', start: 1, end: 2 }))
      .rejects.toThrowError(/calendar.create/);
  });

  v.it('throws a capability error without a calendar port', async () => {
    v.expect(calendarAvailable()).toBe(false);
    await v
      .expect(getCalendarEvents({ start: 0, end: 1 }))
      .rejects.toThrowError(/calendar/);
  });
});

v.describe('sensors', () => {
  v.afterEach(() => setSensorsPort(undefined));

  v.it('watches and reads a host sensor', async () => {
    let unsubscribed = 0;
    setSensorsPort({
      available: (type) => type === 'accelerometer',
      watch(type, listener) {
        listener({ sensor: type, x: 1, y: 2, z: 3, timestamp: 10 });
        return () => unsubscribed++;
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

  v.it('throws a capability error for unsupported sensors', () => {
    v.expect(sensorsAvailable()).toBe(false);
    v.expect(() => watchSensor('barometer', () => {})).toThrowError(
      /sensor.barometer/,
    );
  });
});

v.describe('maps', () => {
  v.afterEach(() => {
    setMapsPort(undefined);
    resetDevicePorts();
  });

  v.it('uses the host map provider and directions', async () => {
    const calls: unknown[] = [];
    setMapsPort({
      async open(options) {
        calls.push(['open', options]);
      },
      async directions(options) {
        calls.push(['directions', options]);
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
    setDevicePorts({
      openExternal: async (url) => {
        opened.push(url);
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
});

v.describe('update delivery', () => {
  v.afterEach(() => {
    setUpdateDeliveryPort(undefined);
    resetDevicePorts();
  });

  const update: UpdateInfo = {
    version: '2.0.0',
    url: 'https://store.test/app',
  };

  v.it('downloads, installs and relaunches through the host', async () => {
    const calls: string[] = [];
    setUpdateDeliveryPort({
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

  v.it('opens the store URL without a delivery port', async () => {
    const opened: string[] = [];
    setDevicePorts({
      openExternal: async (url) => {
        opened.push(url);
      },
    });
    const delivery = createUpdateDelivery();
    v.expect(await delivery.apply(update)).toBe('opened');
    v.expect(opened).toEqual(['https://store.test/app']);
    await v
      .expect(delivery.apply({ version: '2.0.0' }))
      .rejects.toThrowError(/updateDelivery/);
  });
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
