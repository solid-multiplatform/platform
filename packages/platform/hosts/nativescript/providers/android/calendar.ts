import type {
  CalendarEvent,
  CalendarPort,
} from '../../../../src/sdk/calendar.js';
import type { PermissionPort } from '../../../../src/sdk/permissions.js';
import { calendarPermission, requirePermission } from './permission.js';
import { queryRows } from './query.js';
import type { AndroidApp } from './runtime.js';

/**
 * The device calendars' events between two times, read-only, from
 * `CalendarContract.Instances` with the `READ_CALENDAR` permission. Each
 * occurrence of a repeating event is its own entry, so an `id` is the event's
 * id and the occurrence's start. Queried in the background and read back in
 * slices. Phone only.
 */
export function calendar(
  app: AndroidApp,
): CalendarPort & { permission: PermissionPort } {
  const permission = calendarPermission(app);
  return {
    permission,
    async list(query) {
      await requirePermission(permission, 'Calendar');
      const range =
        android.provider.CalendarContract.Instances.CONTENT_URI.buildUpon();
      android.content.ContentUris.appendId(range, query.start);
      android.content.ContentUris.appendId(range, query.end);
      return queryRows<CalendarEvent>(
        app,
        {
          uri: range.build(),
          columns: [
            'event_id',
            'title',
            'begin',
            'end',
            'allDay',
            'eventLocation',
            'description',
            'calendar_id',
          ],
          where: query.calendarId === undefined ? undefined : 'calendar_id = ?',
          args: query.calendarId === undefined ? undefined : [query.calendarId],
          order: 'begin ASC',
        },
        Math.max(0, query.limit ?? Number.MAX_SAFE_INTEGER),
        (cursor) => {
          const begin = cursor.getLong(2);
          const location = cursor.getString(5);
          const notes = cursor.getString(6);
          return {
            id: `${cursor.getLong(0)}:${begin}`,
            title: String(cursor.getString(1) ?? ''),
            start: begin,
            end: cursor.getLong(3),
            allDay: cursor.getInt(4) === 1,
            location: location ? String(location) : undefined,
            notes: notes ? String(notes) : undefined,
            calendarId: String(cursor.getLong(7)),
          };
        },
      );
    },
  };
}
