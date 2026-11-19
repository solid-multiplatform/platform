/** Every section of the showcase: the home grid and the router read this. */
import type { JSX } from 'solid-js';
import { ControlsScreen } from './screens/Controls';
import { DiagnosticsScreen } from './screens/Diagnostics';
import { DialogsScreen } from './screens/Dialogs';
import {
  ContainersScreen,
  EffectsScreen,
  ImagesScreen,
  LayoutScreen,
  MotionScreen,
  StatesScreen,
  TextScreen,
} from './screens/gallery';
import { ListScreen } from './screens/List';
import { ServicesScreen } from './screens/Services';

export interface Section {
  path: string;
  title: string;
  screen: () => JSX.Element;
}

export const sections: readonly Section[] = [
  { path: '/layout', title: 'Layout', screen: LayoutScreen },
  { path: '/text', title: 'Text', screen: TextScreen },
  { path: '/images', title: 'Images', screen: ImagesScreen },
  { path: '/effects', title: 'Effects', screen: EffectsScreen },
  { path: '/states', title: 'States', screen: StatesScreen },
  { path: '/motion', title: 'Transitions', screen: MotionScreen },
  { path: '/containers', title: 'Row, Column, Grid', screen: ContainersScreen },
  { path: '/list', title: 'Virtual list', screen: ListScreen },
  { path: '/dialogs', title: 'Dialogs', screen: DialogsScreen },
  { path: '/controls', title: 'Controls', screen: ControlsScreen },
  { path: '/services', title: 'Services', screen: ServicesScreen },
  { path: '/diagnostics', title: 'Diagnostics', screen: DiagnosticsScreen },
];
