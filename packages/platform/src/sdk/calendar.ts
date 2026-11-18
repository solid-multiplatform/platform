import { CapabilityError } from './services.js';

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

let port: CalendarPort | undefined;

export function setCalendarPort(next: CalendarPort | undefined): void {
  port = next;
}

export function calendarAvailable(): boolean {
  return port !== undefined;
}

/** List events intersecting `[start, end]` through the host calendar. */
export async function getCalendarEvents(
  query: CalendarQuery,
): Promise<CalendarEvent[]> {
  if (!port) throw new CapabilityError('calendar');
  if (query.end < query.start) {
    throw new RangeError('Calendar range end must be after start');
  }
  return port.list(query);
}

/** Create an event. Hosts without write access throw a capability error. */
export async function createCalendarEvent(
  event: CalendarDraft,
): Promise<CalendarEvent> {
  if (!port) throw new CapabilityError('calendar');
  if (!port.create) throw new CapabilityError('calendar.create');
  return port.create(event);
}
