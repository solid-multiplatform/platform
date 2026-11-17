import { createSignal, onCleanup, onMount } from 'solid-js';
import { createRenderer, For, type ElementNode } from '@solid-multiplatform/platform';

/** The same component runs in each host smoke test. */
export function Fixture(props: { root: (node: ElementNode) => void }) {
  const [items, setItems] = createSignal(['first', 'second']);
  let first!: ElementNode;
  onMount(() => {
    first.setFocus();
    const timer = setTimeout(() => setItems(['second', 'first']), 0);
    onCleanup(() => clearTimeout(timer));
  });
  return <view ref={props.root} width={640} height={240} color={0x202020ff}>
    <text ref={first} fontSize={32} color={0xffffffff}>{items().join(' ')}</text>
    <For each={items()}>{(item, index) =>
      <view id={item} x={index() * 80} y={80} width={64} height={64} color={0x4fb3ffff} />
    }</For>
  </view>;
}

export function mount() {
  const { render } = createRenderer();
  let view!: ElementNode;
  const dispose = render(() => <Fixture root={node => { view = node; }} />);
  return () => {
    dispose();
    // Solid universal releases reactive ownership. The host owns its scene nodes.
    if (view.parent) {
      view.parent.removeChild(view);
      view.destroy();
    }
  };
}
