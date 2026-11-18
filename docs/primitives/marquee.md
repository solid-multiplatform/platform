# Marquee

`Marquee` scrolls a single line of text when it is wider than its container.
Text that fits is shown as is.

```tsx
import { createSignal } from 'solid-js';
import { Marquee } from '@solid-multiplatform/platform/primitives';

export const Title = () => {
  const [focused, setFocused] = createSignal(false);

  return (
    <view width={400} height={60} onFocusChanged={setFocused} autofocus>
      <Marquee
        width={400}
        marquee={focused()}
        easing="ease-in-out"
        textProps={{ fontSize: 28 }}
      >
        This is a long text that scrolls when it overflows the container.
      </Marquee>
    </view>
  );
};
```

Drive `marquee` from focus. The animation runs only while `marquee` is `true`
and the text overflows, so a row of unfocused titles schedules nothing.

## Marquee props

`Marquee` accepts every `<view>` prop except `children`, plus:

- `children`: the text.
- `marquee` (`boolean`, required): scroll the text, or show it clipped.
- `speed` (`number`, default `200`): pixels per second.
- `delay` (`number`, default `1000`): milliseconds between two passes.
- `scrollGap` (`number`, default half the container width): space between the
  end of the text and its next pass.
- `easing` (`string`, default `'linear'`): easing of the scroll.
- `textProps` (`TextProps`): props for the inner `<text>` nodes.

`Marquee` reads its width from layout and turns `clipping` on while `marquee`
is `true`. Its height defaults to `textProps.lineHeight`, or 1.5 times the
font size.

## MarqueeText

`MarqueeText` is the part that scrolls. Use it when you manage the clipping
container yourself.

```tsx
import { MarqueeText } from '@solid-multiplatform/platform/primitives';

export const Title = (props: { focused: boolean }) => (
  <view width={400} height={28} clipping>
    <MarqueeText
      clipWidth={400}
      marquee={props.focused}
      speed={200}
      delay={1000}
      scrollGap={24}
    >
      This is a long text that scrolls when it overflows the container.
    </MarqueeText>
  </view>
);
```

`MarqueeText` accepts every `<text>` prop, the `marquee`, `speed`, `delay`,
`scrollGap` and `easing` props above, and:

- `clipWidth` (`number`, required): width of the visible container.
