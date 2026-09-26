import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { SegmentedControl } from './segmented-control';
import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Visibility } from '@/types/models';

/** Labelled input with a counter for the column's varchar limit. */
export function TextField({
  label,
  maxLength,
  value,
  multiline,
  hint,
  ...rest
}: TextInputProps & { label: string; maxLength: number; value: string; hint?: string }) {
  const theme = useTheme();
  const near = value.length > maxLength * 0.9;
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <ThemedText type="smallBold">{label}</ThemedText>
        <ThemedText type="small" style={[styles.counter, { color: near ? theme.danger : theme.textSecondary }]}>
          {value.length}/{maxLength}
        </ThemedText>
      </View>
      <TextInput
        value={value}
        maxLength={maxLength}
        multiline={multiline}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          multiline && styles.multiline,
          { color: theme.text, backgroundColor: theme.backgroundElement },
        ]}
        {...rest}
      />
      {hint && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          {hint}
        </ThemedText>
      )}
    </View>
  );
}

export function VisibilityField({ value, onChange, privateHint }: { value: Visibility; onChange: (v: Visibility) => void; privateHint: string }) {
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">Visibility</ThemedText>
      <SegmentedControl
        value={value}
        onChange={onChange}
        options={[
          { value: 'public', label: 'Public' },
          { value: 'private', label: 'Private' },
        ]}
      />
      <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
        {value === 'public' ? 'Everyone signed in can see it.' : privateHint}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.two },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  counter: { fontSize: 12 },
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
    fontSize: 16,
  },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  hint: { fontSize: 12, lineHeight: 16 },
});
