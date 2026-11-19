// The Roku entry of the shared smoke fixture: one host, one app.
import { startApp } from '@solid-multiplatform/platform/host';
import { rokuHost } from '@solid-multiplatform/platform/roku';
import { Fixture } from '../../shared/app';

startApp(rokuHost(), () => <Fixture root={() => {}} />);
