import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Button } from '../button';
import { Chip } from '../chip';
import { Icon, type IconName } from '../icon';
import { ThemedText } from '../themed-text';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ProjectCategory } from '@/types/models';

/**
 * Runs editor actions one at a time and keeps the last error, which the section shows inline.
 * Every action goes through `mutate` (src/api/store.ts), so the screen refreshes afterwards.
 */
export function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      await action();
      setError(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, error, busy };
}

export function ErrorText({ error }: { error: string | null }) {
  const theme = useTheme();
  if (!error) return null;
  return (
    <ThemedText type="small" style={{ color: theme.danger }}>
      {error}
    </ThemedText>
  );
}

export function Hint({ children }: { children: React.ReactNode }) {
  return (
    <ThemedText type="small" themeColor="textSecondary">
      {children}
    </ThemedText>
  );
}

/** Single-line text box. */
export function Input(props: TextInputProps) {
  const theme = useTheme();
  return (
    <TextInput
      placeholderTextColor={theme.textSecondary}
      {...props}
      style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }, props.style]}
    />
  );
}

/** Text box with a submit button, e.g. "New category" + Add. Clears itself after a successful submit. */
export function AddRow({
  placeholder,
  maxLength,
  submitTitle = 'Add',
  onSubmit,
  busy,
}: {
  placeholder: string;
  maxLength: number;
  submitTitle?: string;
  onSubmit: (value: string) => Promise<boolean>;
  busy?: boolean;
}) {
  const [value, setValue] = useState('');
  const submit = async () => {
    if (value.trim() && (await onSubmit(value.trim()))) setValue('');
  };
  return (
    <View style={styles.row}>
      <Input
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        maxLength={maxLength}
        onSubmitEditing={submit}
        style={styles.flex}
      />
      <Button small icon="add" title={submitTitle} disabled={!value.trim()} loading={busy} onPress={submit} />
    </View>
  );
}

/** Small icon-only button. */
export function IconButton({
  icon,
  label,
  onPress,
  disabled,
  danger,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, (pressed || disabled) && { opacity: disabled ? 0.3 : 0.6 }]}>
      <Icon name={icon} size={18} color={danger ? theme.danger : theme.textSecondary} />
    </Pressable>
  );
}

/** Toggle chips for picking categories. */
export function CategoryPicker({
  categories,
  selected,
  onToggle,
}: {
  categories: ProjectCategory[];
  selected: string[];
  onToggle: (categoryId: string) => void;
}) {
  if (categories.length === 0) return <Hint>Add categories first (see Categories above).</Hint>;
  return (
    <View style={styles.chips}>
      {categories.map((c) => (
        <Chip key={c.id} label={c.name} selected={selected.includes(c.id)} onPress={() => onToggle(c.id)} />
      ))}
    </View>
  );
}

/** Adds `id` to the list, or removes it when it is already there. */
export const toggled = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export const editorStyles = StyleSheet.create({
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one + 2 },
});

const styles = StyleSheet.create({
  ...editorStyles,
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    fontSize: 15,
  },
  iconButton: { padding: Spacing.one },
});
