/** A 2:3 poster card for a rail, with the poster-first hierarchy. */
import { Image } from '@solid-multiplatform/platform/app';
import type { Title } from '../catalog';
import { C } from '../theme';

export function PosterCard(props: {
  title: Title;
  x: number;
  width: number;
  height: number;
  onOpen: (title: Title) => void;
  showRating?: boolean;
}) {
  return (
    <view
      x={props.x}
      y={0}
      width={props.width}
      height={props.height + 30}
      onMouseClick={() => props.onOpen(props.title)}
    >
      <view
        width={props.width}
        height={props.height}
        color={C.surface}
        borderRadius={14}
        clipping
      >
        <Image
          src={props.title.poster}
          width={props.width}
          height={props.height}
          fit="cover"
          borderRadius={14}
          placeholderColor={C.skeleton}
        />
        {/* A quiet bottom scrim so a bright poster still sits in the dark. */}
        <view
          y={props.height - 70}
          width={props.width}
          height={70}
          color={0x00000000}
          linearGradient={{
            colors: [0x0a0a0b00, 0x0a0a0bcc],
            angle: 0,
            stops: [0, 1],
          }}
          borderRadius={[0, 0, 14, 14]}
        />
        {props.showRating !== false && (
          <view
            x={props.width - 52}
            y={8}
            width={44}
            height={22}
            color={0x0a0a0bcc}
            borderRadius={11}
          >
            <text
              x={0}
              y={4}
              width={44}
              contain="width"
              textAlign="center"
              fontSize={11}
              color={C.text}
            >
              {props.title.rating.toFixed(1)}
            </text>
          </view>
        )}
      </view>
      <text
        y={props.height + 9}
        width={props.width}
        contain="width"
        maxLines={1}
        overflowSuffix="…"
        fontSize={13}
        color={C.muted}
      >
        {props.title.title}
      </text>
    </view>
  );
}
