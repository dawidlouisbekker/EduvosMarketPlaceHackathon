import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from './themed-text';

import { BottomTabInset, Spacing } from '@/constants/theme';
import { useStoreVersion } from '@/hooks/use-query';
import type { Page } from '@/types/models';

export const FeedMaxWidth = 640;
const PAGE = 8;

type FeedProps<T extends { id: string }> = {
  /** Changes when the query changes (e.g. the sort); the feed restarts from the top. */
  queryKey: string;
  load: (cursor: string | null, limit: number) => Promise<Page<T>>;
  renderItem: (item: T) => React.ReactElement;
  header?: React.ReactElement;
  empty: string;
};

/** Infinite-scrolling list with pull-to-refresh. Refreshes in place when the store changes (votes, new posts). */
export function Feed<T extends { id: string }>({ queryKey, load, renderItem, header, empty }: FeedProps<T>) {
  const insets = useSafeAreaInsets();
  const version = useStoreVersion();
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'idle' | 'more' | 'refreshing'>('loading');

  // First page, and reload everything loaded so far whenever the data changes.
  useEffect(() => {
    let alive = true;
    load(null, Math.max(PAGE, items.length)).then((page) => {
      if (!alive) return;
      setItems(page.items);
      setCursor(page.next_cursor);
      setStatus('idle');
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, version]);

  // Restart from the top with a spinner when the query itself changes.
  const [shownKey, setShownKey] = useState(queryKey);
  if (shownKey !== queryKey) {
    setShownKey(queryKey);
    setItems([]);
    setStatus('loading');
  }

  const loadMore = () => {
    if (!cursor || status !== 'idle') return;
    setStatus('more');
    load(cursor, PAGE).then((page) => {
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.next_cursor);
      setStatus('idle');
    });
  };

  const refresh = () => {
    setStatus('refreshing');
    load(null, PAGE).then((page) => {
      setItems(page.items);
      setCursor(page.next_cursor);
      setStatus('idle');
    });
  };

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => renderItem(item)}
      ListHeaderComponent={header}
      ListEmptyComponent={
        status === 'loading' ? (
          <ActivityIndicator style={styles.spinner} />
        ) : (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            {empty}
          </ThemedText>
        )
      }
      ListFooterComponent={status === 'more' ? <ActivityIndicator style={styles.spinner} /> : null}
      ItemSeparatorComponent={Separator}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      refreshControl={<RefreshControl refreshing={status === 'refreshing'} onRefresh={refresh} />}
      style={styles.list}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + Spacing.three, paddingBottom: insets.bottom + BottomTabInset + Spacing.six + Spacing.five },
      ]}
    />
  );
}

function Separator() {
  return <View style={{ height: Spacing.three }} />;
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: FeedMaxWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
  },
  spinner: { marginVertical: Spacing.four },
  empty: { textAlign: 'center', marginVertical: Spacing.five },
});
