import { serviceAvailable, withService } from './registry.js';

export interface ContactPhone {
  label?: string;
  number: string;
}

export interface ContactEmail {
  label?: string;
  address: string;
}

export interface Contact {
  id: string;
  displayName: string;
  givenName?: string;
  familyName?: string;
  organization?: string;
  phones?: readonly ContactPhone[];
  emails?: readonly ContactEmail[];
  /** ISO date (YYYY-MM-DD). */
  birthday?: string;
  note?: string;
}

export interface ContactQuery {
  /** Host-side search over names, phones and emails. */
  search?: string;
  /** Maximum results. */
  limit?: number;
  /**
   * Continue a listing: the `next` of the page before. Opaque, and only
   * meaningful to the host that gave it.
   */
  after?: string;
}

/** One page of contacts. `next` is absent on the last page. */
export interface ContactPage {
  contacts: Contact[];
  next?: string;
}

export interface ContactsPort {
  list(query?: ContactQuery): Promise<Contact[]>;
  /**
   * One page of at most `query.limit` contacts, with the cursor of the page
   * after it. A host that cannot page leaves this out.
   */
  page?(query?: ContactQuery): Promise<ContactPage>;
  /** Optional system picker; resolves undefined when the user cancels. */
  pick?(): Promise<Contact | undefined>;
}

declare module './registry.js' {
  interface ServiceProviders {
    contacts: ContactsPort;
  }
}

export function contactsAvailable(): boolean {
  return serviceAvailable('contacts') === 'available';
}

/**
 * Read contacts through the host provider (Android ContactsContract, iOS
 * Contacts, web Contact Picker). Permission prompts belong to the host.
 */
export async function getContacts(
  query: ContactQuery = {},
): Promise<Contact[]> {
  return withService('contacts', (port) => port.list(query));
}

/**
 * Read contacts a page at a time: pass the page's `next` as `after` to get
 * the one that follows. On a host that cannot page, the first call resolves
 * with every match and no `next`.
 */
export async function getContactsPage(
  query: ContactQuery = {},
): Promise<ContactPage> {
  return withService('contacts', async (port) =>
    port.page ? port.page(query) : { contacts: await port.list(query) },
  );
}

/** Open the system contact picker, or undefined when the user cancels. */
export async function pickContact(): Promise<Contact | undefined> {
  return withService('contacts', (port) => port.pick?.());
}
