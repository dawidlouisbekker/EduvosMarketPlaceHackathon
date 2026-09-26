import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { TextField, VisibilityField } from '@/components/form';
import { Icon } from '@/components/icon';
import { ScrollScreen } from '@/components/scroll-screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { createIdea, getProblem, searchProblems } from '@/mock/api';
import type { Visibility } from '@/types/models';

type Link = { problem_id: string; title: string; description: string };

export default function ComposeIdea() {
  const { problemId } = useLocalSearchParams<{ problemId?: string }>();
  const theme = useTheme();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [links, setLinks] = useState<Link[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; title: string }[]>([]);
  const [saving, setSaving] = useState(false);

  // Pre-link the problem this idea was proposed from.
  useEffect(() => {
    if (!problemId) return;
    getProblem(problemId).then((d) => {
      if (d) setLinks([{ problem_id: d.problem.id, title: d.problem.title, description: '' }]);
    });
  }, [problemId]);

  useEffect(() => {
    searchProblems(query).then(setResults);
  }, [query]);

  const linked = new Set(links.map((l) => l.problem_id));
  const valid = title.trim() && description.trim() && links.every((l) => l.description.trim());

  const submit = async () => {
    setSaving(true);
    const id = await createIdea({
      title: title.trim(),
      description: description.trim(),
      visibility,
      problems: links.map((l) => ({ problem_id: l.problem_id, description: l.description.trim() })),
    });
    router.replace({ pathname: '/idea/[id]', params: { id } });
  };

  return (
    <ScrollScreen>
      <TextField label="Idea" placeholder="A short, catchy title" maxLength={128} value={title} onChangeText={setTitle} autoFocus />
      <TextField
        label="How does it work?"
        placeholder="Explain the solution and who it's for"
        maxLength={2048}
        value={description}
        onChangeText={setDescription}
        multiline
      />

      <View style={styles.block}>
        <ThemedText type="smallBold">Problems it solves</ThemedText>
        {links.map((l) => (
          <View key={l.problem_id} style={[styles.link, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.linkHead}>
              <Icon name="problem" size={16} color={theme.danger} />
              <ThemedText type="smallBold" style={styles.flex}>
                {l.title}
              </ThemedText>
              <Pressable
                hitSlop={8}
                onPress={() => setLinks((ls) => ls.filter((x) => x.problem_id !== l.problem_id))}
                accessibilityLabel="Remove">
                <Icon name="close" size={16} color={theme.textSecondary} />
              </Pressable>
            </View>
            <TextInput
              value={l.description}
              maxLength={128}
              onChangeText={(t) =>
                setLinks((ls) => ls.map((x) => (x.problem_id === l.problem_id ? { ...x, description: t } : x)))
              }
              placeholder="How does your idea solve it? (required)"
              placeholderTextColor={theme.textSecondary}
              style={[styles.linkInput, { color: theme.text, borderColor: theme.border }]}
            />
          </View>
        ))}
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search problems to link…"
          placeholderTextColor={theme.textSecondary}
          style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        {results
          .filter((r) => !linked.has(r.id))
          .slice(0, 5)
          .map((r) => (
            <Pressable
              key={r.id}
              onPress={() => setLinks((ls) => [...ls, { problem_id: r.id, title: r.title, description: '' }])}
              style={({ pressed }) => [styles.result, pressed && { opacity: 0.6 }]}>
              <Icon name="add" size={16} color={theme.accent} />
              <ThemedText type="small" style={styles.flex}>
                {r.title}
              </ThemedText>
            </Pressable>
          ))}
      </View>

      <VisibilityField
        value={visibility}
        onChange={setVisibility}
        privateHint="Only you, plus prospects you share it with afterwards."
      />
      <Button title="Post idea" icon="send" disabled={!valid} loading={saving} onPress={submit} />
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
  flex: { flex: 1 },
  link: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  linkHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  linkInput: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.one, fontSize: 14 },
  search: { borderRadius: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two + 2, fontSize: 15 },
  result: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.one },
});
