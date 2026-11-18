import './components/BaseAppScene.xml';
import './components/WorkerTask.xml';
import './components/SolidMotionGroup.xml';
import './components/NativeTextDialogBridge.xml';
import { main, registerAnchorNode } from '@roku-sdk/rsg-ts';
import SolidApp from './anchor';
main(() => registerAnchorNode(SolidApp));
