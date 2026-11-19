/**
 * Screen history: a keyed card list over the host's history. Enter opens a
 * detail route; `restore` reorders the cards the way a refetch would, and the
 * Back key must focus the same card by its key, never by its index. The
 * showcase's own navigation is the SDK stack, so this screen is a self
 * contained history: Back inside it is consumed here, and Back at its root
 * returns to the home grid.
 */
import { createSignal, onCleanup, Show } from 'solid-js';
import {
  createScreenHistory,
  List,
  type ScreenHistory,
} from '@solid-multiplatform/platform/app';
import { viewport } from '@solid-multiplatform/platform/viewport';
import { useShowcase } from '../env';
import { Button, Caption, MARGIN, MUTED, Screen, TEXT } from '../ui';

interface Card {
  id: string;
}

const cards = (ids: readonly string[]): Card[] =>
  ids.map((id) => ({ id }));

const BY_KEY = ['a', 'b', 'c', 'd', 'e', 'f'];
// What a refetch brings back: the same cards, a different order.
const REFETCHED = ['e', 'c', 'a', 'f', 'b', 'd'];
const CARD = '/screen-history';
const DETAIL = '/screen-history/card';

export function ScreenHistoryScreen() {
  const showcase = useShowcase();
  const [items, setItems] = createSignal<Card[]>(cards(BY_KEY));
  let screen!: ScreenHistory<{ card: string }>;
  screen = createScreenHistory<{ card: string }>({
    capture: () => ({ card: screen.current().state?.card ?? '' }),
    restore: (entry) => {
      // Revalidate: the list comes back reordered, so the focused card keeps
      // its key but not its position.
      if (entry.path === CARD) setItems(cards(REFETCHED));
    },
    fallbackPath: CARD,
    // Back at this screen's root is the showcase's Back.
    onBackEmpty: () => showcase.back(),
  });
  screen.replace(CARD);
  onCleanup(() => screen.dispose());
  return (
    <view
      width={viewport().width}
      height={viewport().height}
      onBack={() => {
        // One consumer: this screen owns Back while it is open, so the
        // focus path never reaches the app root with it.
        screen.back();
        return true;
      }}
    >
      <Show
        when={screen.current().path === DETAIL}
        fallback={
          <Screen title="Screen history">
            <Caption>
              Enter opens the card; Back restores focus to the same card by
              its key after a reordering refetch.
            </Caption>
            <List
              focusKey="cards"
              each={items()}
              itemKey={(card: Card) => card.id}
              onSelect={(card: Card) => {
                screen.push(DETAIL, { card: card.id });
              }}
            >
              {(card: Card) => (
                <Button width={520} label={`Card ${card.id.toUpperCase()}`} />
              )}
            </List>
          </Screen>
        }
      >
        <view width={viewport().width} height={viewport().height}>
          <text x={MARGIN} y={18} fontSize={34} color={TEXT}>
            Screen history
          </text>
          <text x={MARGIN} y={68} fontSize={22} color={MUTED}>
            {`Detail: card ${(screen.current().state?.card ?? '').toUpperCase()}. Back returns to the reordered list.`}
          </text>
          <view y={140}>
            <Button label="Detail" width={520} autofocus />
          </view>
        </view>
      </Show>
    </view>
  );
}
