import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Rounded surface for feed items. Pressable when onPress is given. */
export function Card({ children, onPress, style }: { children: React.ReactNode; onPress?: () => void; style?: ViewStyle }) {
  const theme = useTheme();
  const body = <View style={[styles.card, { backgroundColor: theme.backgroundElement }, style]}>{children}</View>;
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.85 }}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Spacing.four - 4, padding: Spacing.three, gap: Spacing.two + 2 },
});
