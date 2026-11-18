import { peekService, serviceAvailable } from './registry.js';

export type MenuItemType = 'normal' | 'separator' | 'checkbox' | 'radio';

export interface MenuItem {
  id: string;
  label?: string;
  type?: MenuItemType;
  /** Accelerator, e.g. `CmdOrCtrl+Shift+P`. */
  shortcut?: string;
  disabled?: boolean;
  enabled?: boolean;
  checked?: boolean;
  submenu?: readonly MenuItem[];
  onSelect?(): void;
}

export interface ApplicationMenu {
  /** macOS application menu title; ignored elsewhere. */
  label?: string;
  items: readonly MenuItem[];
}

export interface TrayOptions {
  /** Icon URL/path or raw image bytes, host-defined. */
  icon?: string | Uint8Array;
  tooltip?: string;
  menu?: readonly MenuItem[];
  onShow?(): void;
}

export interface MenusPort {
  setApplicationMenu(menu: ApplicationMenu | null): void;
  setTray(tray: TrayOptions | null): void;
}

declare module './registry.js' {
  interface ServiceProviders {
    menus: MenusPort;
  }
}

export function menusAvailable(): boolean {
  return serviceAvailable('menus') === 'available';
}

/** Install the native application menu. Pass null to remove it. */
export function setApplicationMenu(menu: ApplicationMenu | null): boolean {
  const port = peekService('menus');
  if (!port) return false;
  port.setApplicationMenu(menu);
  return true;
}

/** Install or remove the system tray icon/menu. */
export function setTray(tray: TrayOptions | null): boolean {
  const port = peekService('menus');
  if (!port) return false;
  port.setTray(tray);
  return true;
}

/** Depth-first lookup by id, including submenus. */
export function findMenuItem(
  menu: ApplicationMenu | readonly MenuItem[],
  id: string,
): MenuItem | undefined {
  const items = Array.isArray(menu)
    ? (menu as readonly MenuItem[])
    : (menu as ApplicationMenu).items;
  for (const item of items) {
    if (item.id === id) return item;
    if (item.submenu) {
      const found = findMenuItem(item.submenu, id);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Invoke a menu action by id, toggling checkbox items. Returns false when the
 * item is missing, disabled or a separator.
 */
export function runMenuItem(
  menu: ApplicationMenu | readonly MenuItem[],
  id: string,
): boolean {
  const item = findMenuItem(menu, id);
  if (
    !item ||
    item.disabled ||
    item.enabled === false ||
    item.type === 'separator'
  )
    return false;
  if (item.type === 'checkbox') item.checked = !item.checked;
  item.onSelect?.();
  return true;
}

export interface MenuItemPayload {
  id: string;
  label?: string;
  type?: MenuItemType;
  shortcut?: string;
  enabled?: boolean;
  disabled?: boolean;
  checked?: boolean;
  submenu?: MenuItemPayload[];
}

/** Strip callbacks so a menu can cross a process/JSON boundary. */
export function menuItemsPayload(
  items: readonly MenuItem[] = [],
): MenuItemPayload[] {
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    type: item.type,
    shortcut: item.shortcut,
    enabled: item.enabled,
    disabled: item.disabled,
    checked: item.checked,
    submenu: item.submenu ? menuItemsPayload(item.submenu) : undefined,
  }));
}
