import type { JSX } from 'solid-js';
import { useTheme } from '../sdk/theme.jsx';
import { viewport } from '../sdk/viewport.js';

export type ListStateStatus = 'loading' | 'empty' | 'error';

export interface ListStateProps {
  status: ListStateStatus | (() => ListStateStatus);
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?(): void;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: JSX.Element;
}

const defaults: Record<
  ListStateStatus,
  { title: string; message: string }
> = {
  loading: {
    title: 'Loading',
    message: 'Fetching the latest items.',
  },
  empty: {
    title: 'Nothing here yet',
    message: 'Items you add will show up here.',
  },
  error: {
    title: 'Something went wrong',
    message: 'Check your connection and try again.',
  },
};

/**
 * Standard loading/empty/error view for lists and async screens, matching the
 * Flutter `AsyncSnapshot` / React Query status branches. The scene stays idle:
 * the loading state is a label, not a frame loop.
 */
export function ListState(props: ListStateProps): JSX.Element {
  const status = () =>
    typeof props.status === 'function' ? props.status() : props.status;
  const theme = () => useTheme();
  const width = () => props.width ?? viewport().width;
  const height = () => props.height ?? viewport().height;
  const x = () => props.x ?? 0;
  const y = () => props.y ?? 0;
  const copy = () => defaults[status()];
  const title = () => props.title ?? copy().title;
  const message = () => props.message ?? copy().message;
  const titleSize = () => theme().typography.title;

  return (
    <view x={x()} y={y()} width={width()} height={height()}>
      <text
        x={0}
        y={height() / 2 - 72}
        width={width()}
        textAlign="center"
        contain="width"
        fontSize={titleSize()}
        color={theme().colors.text}
      >
        {title()}
      </text>
      <text
        x={width() * 0.1}
        y={height() / 2 - 16}
        width={width() * 0.8}
        textAlign="center"
        contain="width"
        fontSize={theme().typography.body}
        color={theme().colors.textMuted}
      >
        {message()}
      </text>
      {props.actionLabel ? (
        <view
          x={width() / 2 - 100}
          y={height() / 2 + 40}
          width={200}
          height={52}
          color={theme().colors.primary}
          onEnter={() => props.onAction?.()}
          onMouseClick={() => props.onAction?.()}
          cursorStyle="pointer"
        >
          <text
            x={0}
            y={14}
            width={200}
            textAlign="center"
            contain="width"
            fontSize={theme().typography.label}
            color={theme().colors.onPrimary}
          >
            {props.actionLabel}
          </text>
        </view>
      ) : null}
      {props.children}
    </view>
  );
}
