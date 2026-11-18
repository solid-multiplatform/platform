// Host-level probe for the GTK/AppIndicator menu provider. Run under a display:
//   DISPLAY=:99 node tests/cli/desktop-menu-probe.mjs
import { createDesktopMenuProvider } from '../../hosts/desktop/menus.mjs';

const provider = await createDesktopMenuProvider();
if (!provider) {
  console.log(JSON.stringify({ ready: false, reason: 'no-python-gtk' }));
  process.exit(0);
}
provider.port.setTray({
  icon: 'dialog-information',
  tooltip: 'Solid menu probe',
  menu: [
    { id: 'open', label: 'Open' },
    { id: 'wrap', label: 'Wrap', type: 'checkbox', checked: false },
    {
      id: 'about',
      label: 'About',
      submenu: [{ id: 'version', label: 'Version' }],
    },
  ],
});
setTimeout(() => {
  console.log(JSON.stringify({ ready: true, items: 3, nested: true }));
  provider.dispose();
  process.exit(0);
}, 300);
