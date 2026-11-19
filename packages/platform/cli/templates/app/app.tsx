import {
  Button,
  List,
  Screen,
  Text,
  createSignal,
  usePlugins,
} from '@solid-multiplatform/platform/app';

// The app is this component. Each target's entry is generated around it, with
// the fonts, design size and theme from solid-platform.config.json.
// A target that needs its own layout gets its own file: app.tv.tsx,
// app.mobile.tsx or app.roku.tsx replaces this one there
// (`solid-platform explain roku app` shows which file a target uses).
export default function App() {
  const plugins = usePlugins<{ run(): Promise<string> }>();
  const [message, setMessage] = createSignal('__APP_NAME__');
  const [count, setCount] = createSignal(0);
  const run = (name: string) =>
    void plugins[name]!.run().then(setMessage, (error) =>
      setMessage(String(error)),
    );
  return (
    <Screen>
      <Text size="title">{message()}</Text>
      <Button onPress={() => setCount(count() + 1)}>
        {`Pressed ${count()} times`}
      </Button>
      <List each={Object.keys(plugins)} onSelect={run}>
        {(name) => <Button>{name}</Button>}
      </List>
    </Screen>
  );
}
