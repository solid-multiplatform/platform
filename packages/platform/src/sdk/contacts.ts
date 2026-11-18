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
}

export interface ContactsPort {
  list(query?: ContactQuery): Promise<Contact[]>;
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

/** Open the system contact picker, or undefined when the user cancels. */
export async function pickContact(): Promise<Contact | undefined> {
  return withService('contacts', (port) => port.pick?.());
}
