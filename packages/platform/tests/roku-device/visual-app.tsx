// Draws the device visual test: one screen of flat-colour cases, built through
// the platform's JSX path as an app would. run-visual.mjs installs it, takes a
// screenshot and probes the pixels. Each case mounts on its own, so one that
// throws is reported on the console and the rest still draw.
import { createSignal, type JSXElement } from 'solid-js';
import {
  createRenderer,
  loadFonts,
  setRendererFactory,
} from '@solid-multiplatform/platform';
import { rokuHost } from '@solid-multiplatform/platform/roku';
import robotoRegular from './fonts/Roboto-Regular.ttf';
import {
  BG,
  CASES as C,
  LABELS,
  PANEL,
  SCREEN,
  labelAt,
} from './visual-cases.mjs';

// The radius of the animated case: 0 at mount, the case's radius soon after.
const [animatedRadius, setAnimatedRadius] = createSignal(0);

const cases: Record<string, () => JSXElement> = {
  animatedRadius: () => (
    <view
      x={C.animatedRadius.x}
      y={C.animatedRadius.y}
      width={C.animatedRadius.w}
      height={C.animatedRadius.h}
      color={C.animatedRadius.color}
      borderRadius={animatedRadius()}
      transition={{ borderRadius: { duration: 400 } }}
    />
  ),
  rounded: () => (
    <view
      x={C.rounded.x}
      y={C.rounded.y}
      width={C.rounded.w}
      height={C.rounded.h}
      color={C.rounded.color}
      borderRadius={C.rounded.radius}
    />
  ),
  roundedCorners: () => (
    <view
      x={C.roundedCorners.x}
      y={C.roundedCorners.y}
      width={C.roundedCorners.w}
      height={C.roundedCorners.h}
      color={C.roundedCorners.color}
      borderRadius={C.roundedCorners.radius}
    />
  ),
  pill: () => (
    <view
      x={C.pill.x}
      y={C.pill.y}
      width={C.pill.w}
      height={C.pill.h}
      color={C.pill.color}
      borderRadius={C.pill.radius}
    />
  ),
  borderInside: () => (
    <view
      x={C.borderInside.x}
      y={C.borderInside.y}
      width={C.borderInside.w}
      height={C.borderInside.h}
      color={C.borderInside.color}
      border={{
        width: C.borderInside.borderWidth,
        color: C.borderInside.borderColor,
        align: 'inside',
      }}
    />
  ),
  imageRounded: () => (
    <view
      x={C.imageRounded.x}
      y={C.imageRounded.y}
      width={C.imageRounded.w}
      height={C.imageRounded.h}
      src={C.imageRounded.src}
      color={0xffffffff}
      borderRadius={C.imageRounded.radius}
      border={{
        width: C.imageRounded.borderWidth,
        color: C.imageRounded.borderColor,
      }}
    />
  ),
  imageCrop: () => (
    <view
      x={C.imageCrop.x}
      y={C.imageCrop.y}
      width={C.imageCrop.w}
      height={C.imageCrop.h}
      src={C.imageCrop.src}
      color={C.imageCrop.color}
      srcX={C.imageCrop.srcX}
      srcY={C.imageCrop.srcY}
      srcWidth={C.imageCrop.srcWidth}
      srcHeight={C.imageCrop.srcHeight}
    />
  ),
  cornersRounded: () => (
    <view
      x={C.cornersRounded.x}
      y={C.cornersRounded.y}
      width={C.cornersRounded.w}
      height={C.cornersRounded.h}
      colorTl={C.cornersRounded.colorTl}
      colorTr={C.cornersRounded.colorTr}
      colorBl={C.cornersRounded.colorBl}
      colorBr={C.cornersRounded.colorBr}
      borderRadius={C.cornersRounded.radius}
    />
  ),
  borderGap: () => (
    <view
      x={C.borderGap.x}
      y={C.borderGap.y}
      width={C.borderGap.w}
      height={C.borderGap.h}
      color={C.borderGap.color}
      border={{
        width: C.borderGap.borderWidth,
        color: C.borderGap.borderColor,
        gap: C.borderGap.borderGap,
      }}
    />
  ),
  border: () => (
    <view
      x={C.border.x}
      y={C.border.y}
      width={C.border.w}
      height={C.border.h}
      color={C.border.color}
      border={{ width: C.border.borderWidth, color: C.border.borderColor }}
    />
  ),
  roundedBorder: () => (
    <view
      x={C.roundedBorder.x}
      y={C.roundedBorder.y}
      width={C.roundedBorder.w}
      height={C.roundedBorder.h}
      color={C.roundedBorder.color}
      borderRadius={C.roundedBorder.radius}
      border={{
        width: C.roundedBorder.borderWidth,
        color: C.roundedBorder.borderColor,
      }}
    />
  ),
  borderBottom: () => (
    <view
      x={C.borderBottom.x}
      y={C.borderBottom.y}
      width={C.borderBottom.w}
      height={C.borderBottom.h}
      color={C.borderBottom.color}
      borderBottom={{
        width: C.borderBottom.borderWidth,
        color: C.borderBottom.borderColor,
      }}
    />
  ),
  roundedGradient: () => (
    <view
      x={C.roundedGradient.x}
      y={C.roundedGradient.y}
      width={C.roundedGradient.w}
      height={C.roundedGradient.h}
      colorTop={C.roundedGradient.colorTop}
      colorBottom={C.roundedGradient.colorBottom}
      borderRadius={C.roundedGradient.radius}
    />
  ),
  linear0: () => linear(C.linear0),
  linear90: () => linear(C.linear90),
  linear45: () => linear(C.linear45),
  linear45wide: () => linear(C.linear45wide),
  linear3: () => linear(C.linear3),
  linear4: () => linear(C.linear4),
  radial: () => (
    <view
      x={C.radial.x}
      y={C.radial.y}
      width={C.radial.w}
      height={C.radial.h}
      radialGradient={{
        colors: C.radial.colors,
        stops: C.radial.stops,
        w: C.radial.radiusW,
        h: C.radial.radiusH,
        pivot: C.radial.pivot as [number, number],
      }}
    />
  ),
  topBottom: () => (
    <view
      x={C.topBottom.x}
      y={C.topBottom.y}
      width={C.topBottom.w}
      height={C.topBottom.h}
      colorTop={C.topBottom.colorTop}
      colorBottom={C.topBottom.colorBottom}
    />
  ),
  leftRight: () => (
    <view
      x={C.leftRight.x}
      y={C.leftRight.y}
      width={C.leftRight.w}
      height={C.leftRight.h}
      colorLeft={C.leftRight.colorLeft}
      colorRight={C.leftRight.colorRight}
    />
  ),
  corners: () => (
    <view
      x={C.corners.x}
      y={C.corners.y}
      width={C.corners.w}
      height={C.corners.h}
      colorTl={C.corners.colorTl}
      colorTr={C.corners.colorTr}
      colorBl={C.corners.colorBl}
      colorBr={C.corners.colorBr}
    />
  ),
  shadow: () => (
    <view
      x={C.shadow.panel.x}
      y={C.shadow.panel.y}
      width={C.shadow.panel.w}
      height={C.shadow.panel.h}
      color={PANEL}
    >
      <view
        x={C.shadow.x - C.shadow.panel.x}
        y={C.shadow.y - C.shadow.panel.y}
        width={C.shadow.w}
        height={C.shadow.h}
        color={C.shadow.color}
        borderRadius={C.shadow.radius}
        shadow={{
          color: C.shadow.shadowColor,
          x: C.shadow.shadowX,
          y: C.shadow.shadowY,
          blur: C.shadow.shadowBlur,
          spread: C.shadow.shadowSpread,
        }}
      />
    </view>
  ),
  clip: () => (
    <view
      x={C.clip.x}
      y={C.clip.y}
      width={C.clip.w}
      height={C.clip.h}
      color={C.clip.color}
      clipping
    >
      <view
        x={C.clip.child.x}
        y={C.clip.child.y}
        width={C.clip.child.w}
        height={C.clip.child.h}
        color={C.clip.child.color}
      />
    </view>
  ),
  textOverGradient: () => (
    <view
      x={C.textOverGradient.x}
      y={C.textOverGradient.y}
      width={C.textOverGradient.w}
      height={C.textOverGradient.h}
      linearGradient={{
        angle: C.textOverGradient.angle,
        colors: C.textOverGradient.colors,
      }}
    >
      <text
        y={(C.textOverGradient.h - C.textOverGradient.fontSize) / 2}
        width={C.textOverGradient.w}
        contain="width"
        textAlign="center"
        fontFamily="Roboto"
        fontSize={C.textOverGradient.fontSize}
        color={C.textOverGradient.textColor}
      >
        {C.textOverGradient.text}
      </text>
    </view>
  ),
};

function linear(c: {
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  colors: number[];
  stops?: number[];
}) {
  return (
    <view
      x={c.x}
      y={c.y}
      width={c.w}
      height={c.h}
      linearGradient={
        c.stops
          ? { angle: c.angle, colors: c.colors, stops: c.stops }
          : { angle: c.angle, colors: c.colors }
      }
    />
  );
}

/**
 * Draws the screen. `effectTier` holds the SceneGraph backend to one way of
 * drawing effects (see visual-app-assets.tsx); without it the backend picks
 * by what the device reports.
 */
export function launchWith(effectTier?: 'native' | 'assets'): void {
  // Each case renders on its own, so the test takes the host's renderer and
  // calls createRenderer itself.
  rokuHost().launch((context) => {
    setRendererFactory(
      (settings) => context.createRenderer(settings),
      context.loadFonts,
    );
    return mountWith(effectTier);
  });
}

function mountWith(effectTier?: 'native' | 'assets'): () => void {
  console.log('VISUAL START');
  void loadFonts([{ fontFamily: 'Roboto', fontUrl: robotoRegular }]).catch(
    (error) => console.log('VISUAL FONT ' + String(error)),
  );
  const { render } = createRenderer(
    effectTier ? ({ effectTier } as never) : undefined,
  );
  render(() => <view width={SCREEN.w} height={SCREEN.h} color={BG} />);
  // Drawn in the order of LABELS, which is the order of the grid.
  Object.keys(LABELS).forEach((name, i) => {
    const at = labelAt(i);
    try {
      render(() => (
        <text
          x={at.x}
          y={at.y}
          fontFamily="Roboto"
          fontSize={22}
          color={0xa0a8b0ff}
        >
          {(LABELS as Record<string, string>)[name]}
        </text>
      ));
      render(cases[name]!);
      console.log('VISUAL CASE ' + name + ' mounted');
    } catch (error) {
      console.log(
        'VISUAL CASE ' +
          name +
          ' threw ' +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  });
  setTimeout(() => setAnimatedRadius(C.animatedRadius.radius), 500);
  // Images (ramps, shadows) load after the first frame, and the animation
  // above has ended by then.
  setTimeout(() => console.log('VISUAL READY'), 3000);
  return () => {};
}
