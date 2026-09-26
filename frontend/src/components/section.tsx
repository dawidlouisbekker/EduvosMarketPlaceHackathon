import { StyleSheet, View } from 'react-native';

import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';

/** Titled block on a detail screen. */
export function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.title}>
          {title.toUpperCase()}
        </ThemedText>
        {right}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 12, letterSpacing: 0.8 },
});
