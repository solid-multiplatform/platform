import type {
  Contact,
  ContactEmail,
  ContactPhone,
  ContactQuery,
  ContactsPort,
} from '../../../../src/sdk/contacts.js';
import type { PermissionPort } from '../../../../src/sdk/permissions.js';
import { contactsPermission, requirePermission } from './permission.js';
import { queryRows } from './query.js';
import type { AndroidApp } from './runtime.js';

/**
 * Android continues a listing after the last contact of the one before:
 * its `after` cursor is that contact's `id`.
 */
export type AndroidContactQuery = ContactQuery;

/** Contacts fetched per round trip to the provider. */
const PAGE = 200;

const ITEM = 'vnd.android.cursor.item/';
const NAME = ITEM + 'name';
const PHONE = ITEM + 'phone_v2';
const EMAIL = ITEM + 'email_v2';
const ORGANIZATION = ITEM + 'organization';
const NOTE = ITEM + 'note';
const EVENT = ITEM + 'contact_event';
const KINDS = [NAME, PHONE, EMAIL, ORGANIZATION, NOTE, EVENT];

const PHONE_LABELS: Record<string, string> = {
  1: 'home',
  2: 'mobile',
  3: 'work',
};
const EMAIL_LABELS: Record<string, string> = {
  1: 'home',
  2: 'work',
  4: 'mobile',
};

type Draft = {
  -readonly [K in keyof Contact]: Contact[K];
} & { phones: ContactPhone[]; emails: ContactEmail[] };

/**
 * `ContactsContract` through the content resolver, read-only, with the
 * `READ_CONTACTS` permission. Contacts come in id order, a page at a time:
 * each page is one background query for the contacts and one for their
 * details, read back in slices. Phone only.
 */
export function contacts(
  app: AndroidApp,
): ContactsPort & { permission: PermissionPort } {
  const permission = contactsPermission(app);
  const Contacts = android.provider.ContactsContract.Contacts;

  async function page(
    search: string | undefined,
    after: number,
    size: number,
  ): Promise<Draft[]> {
    const base = search
      ? android.net.Uri.withAppendedPath(
          Contacts.CONTENT_FILTER_URI,
          android.net.Uri.encode(search),
        )
      : Contacts.CONTENT_URI;
    const found = await queryRows<Draft>(
      app,
      {
        uri: base
          .buildUpon()
          .appendQueryParameter('limit', String(size))
          .build(),
        columns: ['_id', 'display_name'],
        where: '_id > ?',
        args: [String(after)],
        order: '_id ASC',
      },
      size,
      (cursor) => ({
        id: String(cursor.getLong(0)),
        displayName: String(cursor.getString(1) ?? ''),
        phones: [],
        emails: [],
      }),
    );
    if (!found.length) return found;
    const byId = new Map(found.map((contact) => [contact.id, contact]));
    const marks = (count: number): string =>
      Array.from({ length: count }, () => '?').join(',');
    await queryRows(
      app,
      {
        uri: android.provider.ContactsContract.Data.CONTENT_URI,
        columns: ['contact_id', 'mimetype', 'data1', 'data2', 'data3'],
        where: `contact_id IN (${marks(found.length)}) AND mimetype IN (${marks(KINDS.length)})`,
        args: [...byId.keys(), ...KINDS],
      },
      Number.MAX_SAFE_INTEGER,
      (cursor) => {
        const contact = byId.get(String(cursor.getLong(0)));
        if (!contact) return;
        const kind = String(cursor.getString(1));
        const first = cursor.getString(2);
        const second = cursor.getString(3);
        const third = cursor.getString(4);
        if (kind === NAME) {
          if (second) contact.givenName = String(second);
          if (third) contact.familyName = String(third);
        } else if (kind === PHONE && first)
          contact.phones.push({
            number: String(first),
            label:
              PHONE_LABELS[String(second)] ??
              (third ? String(third) : undefined),
          });
        else if (kind === EMAIL && first)
          contact.emails.push({
            address: String(first),
            label:
              EMAIL_LABELS[String(second)] ??
              (third ? String(third) : undefined),
          });
        else if (kind === ORGANIZATION && first)
          contact.organization = String(first);
        else if (kind === NOTE && first) contact.note = String(first);
        // Event type 3 is a birthday.
        else if (kind === EVENT && first && String(second) === '3')
          contact.birthday = String(first);
      },
    );
    return found;
  }

  return {
    permission,
    async list(query: AndroidContactQuery = {}) {
      await requirePermission(permission, 'Contacts');
      const limit = Math.max(0, query.limit ?? Number.MAX_SAFE_INTEGER);
      const all: Contact[] = [];
      let after = Number(query.after ?? 0) || 0;
      while (all.length < limit) {
        const size = Math.min(PAGE, limit - all.length);
        const batch = await page(query.search, after, size);
        all.push(...batch);
        if (batch.length < size) break;
        after = Number(batch[batch.length - 1]!.id);
      }
      return all;
    },
    async page(query: ContactQuery = {}) {
      await requirePermission(permission, 'Contacts');
      const size = Math.min(PAGE, Math.max(0, query.limit ?? PAGE));
      if (size === 0) return { contacts: [] };
      const contacts: Contact[] = await page(
        query.search,
        Number(query.after ?? 0) || 0,
        size,
      );
      // A full page may have more behind it; a short one is the last.
      return contacts.length < size
        ? { contacts }
        : { contacts, next: contacts[contacts.length - 1]!.id };
    },
  };
}
