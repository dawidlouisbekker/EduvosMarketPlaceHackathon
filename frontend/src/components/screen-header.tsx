import { StyleSheet, View } from 'react-native';

import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';

/** Large title at the top of a tab screen. */
export function ScreenHeader({ title, right, children }: { title: string; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <ThemedText style={styles.title}>{title}</ThemedText>
        {right}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.three, paddingBottom: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 30, lineHeight: 38, fontWeight: 800 },
});
