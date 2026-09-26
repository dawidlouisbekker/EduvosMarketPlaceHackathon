import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { TextField, VisibilityField } from '@/components/form';
import { ScrollScreen } from '@/components/scroll-screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { createProject, getIdea } from '@/mock/api';
import type { Visibility } from '@/types/models';

const DAY = 86_400_000;
const DEADLINES = [
  { label: 'No deadline', days: null },
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
  { label: '6 months', days: 180 },
] as const;

export default function ComposeProject() {
  const { ideaId } = useLocalSearchParams<{ ideaId?: string }>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [days, setDays] = useState<number | null>(30);
  const [ideaTitle, setIdeaTitle] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Starting from an idea: prefill from it; the idea gets linked via ideas.project_id.
  useEffect(() => {
    if (!ideaId) return;
    getIdea(ideaId).then((idea) => {
      if (!idea) return;
      setIdeaTitle(idea.title);
      setName(idea.title.slice(0, 128));
      setDescription(idea.description);
      setVisibility(idea.visibility);
    });
  }, [ideaId]);

  const submit = async () => {
    setSaving(true);
    const id = await createProject({
      name: name.trim(),
      description: description.trim(),
      visibility,
      deadline: days ? new Date(Date.now() + days * DAY).toISOString() : null,
      idea_id: ideaId ?? null,
    });
    router.replace({ pathname: '/project/[id]', params: { id } });
  };

  return (
    <ScrollScreen>
      {ideaTitle && <Chip icon="idea" label={`From idea: ${ideaTitle}`} selected />}
      <TextField label="Project name" maxLength={128} value={name} onChangeText={setName} autoFocus={!ideaId} />
      <TextField
        label="Description"
        placeholder="What are you building, and what does done look like?"
        maxLength={2048}
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <View style={styles.block}>
        <ThemedText type="smallBold">Deadline</ThemedText>
        <View style={styles.chips}>
          {DEADLINES.map((d) => (
            <Chip key={d.label} label={d.label} selected={days === d.days} onPress={() => setDays(d.days)} />
          ))}
        </View>
      </View>
      <VisibilityField
        value={visibility}
        onChange={setVisibility}
        privateHint="Only you and participants. Only your prospects can request to join."
      />
      <ThemedText type="small" themeColor="textSecondary">
        You can add roles, categories, tasks and videos after creating the project.
      </ThemedText>
      <Button title="Create project" icon="project" disabled={!name.trim()} loading={saving} onPress={submit} />
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
