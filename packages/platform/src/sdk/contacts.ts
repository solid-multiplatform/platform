import { CapabilityError } from './services.js';

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

let port: ContactsPort | undefined;

export function setContactsPort(next: ContactsPort | undefined): void {
  port = next;
}

export function contactsAvailable(): boolean {
  return port !== undefined;
}

/**
 * Read contacts through the host provider (Android ContactsContract, iOS
 * Contacts, web Contact Picker). Permission prompts belong to the host.
 */
export async function getContacts(
  query: ContactQuery = {},
): Promise<Contact[]> {
  if (!port) throw new CapabilityError('contacts');
  return port.list(query);
}

/** Open the system contact picker, or undefined when the user cancels. */
export async function pickContact(): Promise<Contact | undefined> {
  if (!port) throw new CapabilityError('contacts');
  return port.pick?.();
}
