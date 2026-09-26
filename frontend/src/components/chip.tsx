import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from './icon';
import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ChipProps = {
  label: string;
  icon?: IconName;
  /** Custom colour, e.g. an idea_comment_types.color. Tints text and background. */
  color?: string;
  selected?: boolean;
  onPress?: () => void;
};

export function Chip({ label, icon, color, selected, onPress }: ChipProps) {
  const theme = useTheme();
  const fg = color ?? (selected ? theme.accent : theme.textSecondary);
  const bg = color ? `${color}22` : selected ? theme.accentSoft : theme.backgroundSelected;
  const body = (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      {icon && <Icon name={icon} size={12} color={fg} />}
      <ThemedText type="small" style={[styles.label, { color: fg }]} numberOfLines={1}>
        {label}
      </ThemedText>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.7 }} hitSlop={4}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: 999,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  label: { fontSize: 12, lineHeight: 18, flexShrink: 1 },
});
