import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Chip } from './chip';
import { SegmentedControl } from './segmented-control';
import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Visibility } from '@/types/models';
import { shortDate } from '@/utils/time';

const DAY = 86_400_000;

/** ISO 8601 timestamp `days` from now. */
export const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const DEADLINES = [
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
  { label: '6 months', days: 180 },
] as const;

/**
 * Deadline picker: presets from today, "No deadline" (when `optional`), and "Keep <date>" for the value being
 * edited. `value` is an ISO 8601 string, or null for no deadline.
 */
export function DeadlineField({
  label = 'Deadline',
  value,
  onChange,
  initial,
  optional,
  preset: initialPreset,
}: {
  label?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  /** The saved deadline when editing, offered as "Keep <date>". */
  initial?: string | null;
  optional?: boolean;
  /** Label of the preset `value` was set from, e.g. "1 month". */
  preset?: string;
}) {
  const [preset, setPreset] = useState<string>(
    initialPreset ?? (value === null ? 'none' : value === initial ? 'keep' : ''),
  );
  const pick = (key: string, next: string | null) => {
    setPreset(key);
    onChange(next);
  };
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <View style={styles.chips}>
        {optional && <Chip label="No deadline" selected={preset === 'none'} onPress={() => pick('none', null)} />}
        {initial && <Chip label={`Keep ${shortDate(initial)}`} selected={preset === 'keep'} onPress={() => pick('keep', initial)} />}
        {DEADLINES.map((d) => (
          <Chip
            key={d.label}
            label={d.label}
            selected={preset === d.label}
            onPress={() => pick(d.label, inDays(d.days))}
          />
        ))}
      </View>
    </View>
  );
}

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
  const isPrivate = value === Visibility.PRIVATE;
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">Visibility</ThemedText>
      <SegmentedControl
        value={isPrivate ? 'private' : 'public'}
        onChange={(v) => onChange(v === 'private' ? Visibility.PRIVATE : Visibility.PUBLIC)}
        options={[
          { value: 'public', label: 'Public' },
          { value: 'private', label: 'Private' },
        ]}
      />
      <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
        {isPrivate ? privateHint : 'Everyone signed in can see it.'}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
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
