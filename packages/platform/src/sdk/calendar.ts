import { CapabilityError, serviceAvailable, withService } from './registry.js';

export interface CalendarRange {
  /** Unix milliseconds. */
  start: number;
  /** Unix milliseconds. */
  end: number;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay?: boolean;
  location?: string;
  notes?: string;
  calendarId?: string;
}

export interface CalendarQuery extends CalendarRange {
  calendarId?: string;
  limit?: number;
}

export type CalendarDraft = Omit<CalendarEvent, 'id'> & { id?: string };

export interface CalendarPort {
  list(query: CalendarQuery): Promise<CalendarEvent[]>;
  create?(event: CalendarDraft): Promise<CalendarEvent>;
}

declare module './registry.js' {
  interface ServiceProviders {
    calendar: CalendarPort;
  }
}

export function calendarAvailable(): boolean {
  return serviceAvailable('calendar') === 'available';
}

/** List events intersecting `[start, end]` through the host calendar. */
export async function getCalendarEvents(
  query: CalendarQuery,
): Promise<CalendarEvent[]> {
  return withService('calendar', (port) => {
    if (query.end < query.start) {
      throw new RangeError('Calendar range end must be after start');
    }
    return port.list(query);
  });
}

/** Create an event. Hosts without write access throw a capability error. */
export async function createCalendarEvent(
  event: CalendarDraft,
): Promise<CalendarEvent> {
  return withService('calendar', (port) => {
    if (!port.create) throw new CapabilityError('calendar.create');
    return port.create(event);
  });
}
