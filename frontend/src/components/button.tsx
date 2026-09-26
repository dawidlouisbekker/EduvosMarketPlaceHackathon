import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from './icon';
import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
};

export function Button({ title, onPress, variant = 'primary', icon, disabled, loading, small }: Props) {
  const theme = useTheme();
  const bg = variant === 'primary' ? theme.accent : theme.backgroundSelected;
  const fg = variant === 'primary' ? '#fff' : variant === 'danger' ? theme.danger : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [(pressed || disabled) && { opacity: disabled ? 0.45 : 0.75 }]}>
      <View style={[styles.button, small && styles.small, { backgroundColor: bg }]}>
        {loading ? (
          <ActivityIndicator color={fg} size="small" />
        ) : (
          <>
            {icon && <Icon name={icon} size={small ? 14 : 16} color={fg} />}
            <ThemedText type="smallBold" style={{ color: fg }}>
              {title}
            </ThemedText>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: 999,
  },
  small: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2 },
});
