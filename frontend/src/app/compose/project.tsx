import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { DeadlineField, inDays, TextField, VisibilityField } from '@/components/form';
import { ScrollScreen } from '@/components/scroll-screen';
import { ThemedText } from '@/components/themed-text';
import { createProject, getIdea } from '@/api';
import { Visibility } from '@/types/models';

export default function ComposeProject() {
  const { ideaId } = useLocalSearchParams<{ ideaId?: string }>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>(Visibility.PUBLIC);
  const [deadline, setDeadline] = useState<string | null>(() => inDays(30));
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
      deadline: deadline ?? undefined,
      idea_id: ideaId,
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
      <DeadlineField optional preset="1 month" value={deadline} onChange={setDeadline} />
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
