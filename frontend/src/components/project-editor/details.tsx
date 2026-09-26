import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { Button } from '../button';
import { DeadlineField, TextField, VisibilityField } from '../form';
import { Section } from '../section';
import { ThemedText } from '../themed-text';
import { ErrorText, useAction } from './shared';

import { updateProject } from '@/api';
import { Spacing } from '@/constants/theme';
import type { ProjectDetail } from '@/types/models';

/** Name, description, visibility, deadline and whether videos show. Saved together with one button. */
export function DetailsSection({ project }: { project: ProjectDetail }) {
  const saved = {
    name: project.name,
    description: project.description,
    visibility: project.visibility,
    deadline: project.deadline ?? null,
    show_media: project.show_media,
  };
  const [draft, setDraft] = useState(saved);
  const { run, error, busy } = useAction();
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const changed = (Object.keys(saved) as (keyof typeof saved)[]).some((k) => draft[k] !== saved[k]);
  const valid = draft.name.trim().length > 0;

  const save = () =>
    run(() =>
      updateProject(project.id, {
        name: draft.name.trim() !== saved.name ? draft.name.trim() : undefined,
        description: draft.description.trim() !== saved.description ? draft.description.trim() : undefined,
        visibility: draft.visibility !== saved.visibility ? draft.visibility : undefined,
        deadline: draft.deadline !== saved.deadline && draft.deadline ? draft.deadline : undefined,
        clear_deadline: draft.deadline === null && saved.deadline !== null,
        show_media: draft.show_media !== saved.show_media ? draft.show_media : undefined,
      }),
    );

  return (
    <Section title="Details">
      <TextField label="Project name" maxLength={128} value={draft.name} onChangeText={(v) => set('name', v)} />
      <TextField
        label="Description"
        maxLength={2048}
        value={draft.description}
        onChangeText={(v) => set('description', v)}
        multiline
      />
      <VisibilityField
        value={draft.visibility}
        onChange={(v) => set('visibility', v)}
        privateHint="Only you and participants. Only your prospects can request to join."
      />
      <DeadlineField optional value={draft.deadline} initial={saved.deadline} onChange={(v) => set('deadline', v)} />
      <View style={styles.switchRow}>
        <ThemedText type="smallBold" style={styles.flex}>
          Show videos on the project page
        </ThemedText>
        <Switch value={draft.show_media} onValueChange={(v) => set('show_media', v)} />
      </View>
      <ErrorText error={error} />
      <Button title="Save details" icon="check" disabled={!changed || !valid} loading={busy} onPress={save} />
    </Section>
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  flex: { flex: 1 },
});
