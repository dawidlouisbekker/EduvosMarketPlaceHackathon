import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from './icon';
import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  count: number;
  active: boolean;
  onToggle: () => void;
  icon?: IconName;
  /** Shown before the count, e.g. "Me too". */
  label?: string;
};

/** Toggle pill (upvote / "me too"). Updates optimistically, then follows the server value. */
export function VoteButton({ count, active, onToggle, icon = 'up', label }: Props) {
  const theme = useTheme();
  const [local, setLocal] = useState({ count, active });
  // Follow the server value whenever it changes.
  const [server, setServer] = useState({ count, active });
  if (server.count !== count || server.active !== active) {
    setServer({ count, active });
    setLocal({ count, active });
  }

  const fg = local.active ? theme.accent : theme.textSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: local.active }}
      hitSlop={6}
      onPress={() => {
        setLocal((s) => ({ active: !s.active, count: s.count + (s.active ? -1 : 1) }));
        onToggle();
      }}
      style={({ pressed }) => pressed && { opacity: 0.7 }}>
      <View style={[styles.pill, { backgroundColor: local.active ? theme.accentSoft : theme.backgroundSelected }]}>
        <Icon name={icon} size={14} color={fg} />
        <ThemedText type="smallBold" style={{ color: fg }}>
          {label ? `${label} · ${local.count}` : local.count}
        </ThemedText>
      </View>
    </Pressable>
  );
}

/** Non-interactive icon + number, e.g. comment count. */
export function Stat({ icon, value }: { icon: IconName; value: number | string }) {
  const theme = useTheme();
  return (
    <View style={styles.stat}>
      <Icon name={icon} size={14} color={theme.textSecondary} />
      <ThemedText type="small" themeColor="textSecondary">
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.one,
    borderRadius: 999,
  },
  stat: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
});
