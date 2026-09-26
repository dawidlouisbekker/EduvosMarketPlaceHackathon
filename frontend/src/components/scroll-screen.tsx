import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FeedMaxWidth } from './feed';

import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Scrollable, centred page column. `tab` screens have no navigation header, so they pad for the
 * status bar and the tab bar themselves.
 */
export function ScrollScreen({ children, tab, footer }: { children: React.ReactNode; tab?: boolean; footer?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: tab ? insets.top + Spacing.three : Spacing.three,
            paddingBottom: (tab ? BottomTabInset : 0) + insets.bottom + Spacing.five,
          },
        ]}>
        {children}
      </ScrollView>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: FeedMaxWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    gap: Spacing.four,
  },
});
