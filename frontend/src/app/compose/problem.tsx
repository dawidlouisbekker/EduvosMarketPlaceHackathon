import { router } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/button';
import { TextField } from '@/components/form';
import { ScrollScreen } from '@/components/scroll-screen';
import { createProblem } from '@/api';

export default function ComposeProblem() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const valid = title.trim() && description.trim();

  const submit = async () => {
    setSaving(true);
    const id = await createProblem({ title: title.trim(), description: description.trim() });
    router.replace({ pathname: '/problem/[id]', params: { id } });
  };

  return (
    <ScrollScreen>
      <TextField
        label="What's the problem?"
        placeholder="e.g. Cafeteria queues eat half my lunch break"
        maxLength={128}
        value={title}
        onChangeText={setTitle}
        autoFocus
      />
      <TextField
        label="Describe it"
        placeholder="Who has this problem, when does it happen, and why does it matter?"
        maxLength={1024}
        value={description}
        onChangeText={setDescription}
        multiline
        hint="Describe the problem, not a solution. Solutions go in Ideas."
      />
      <Button title="Post problem" icon="send" disabled={!valid} loading={saving} onPress={submit} />
    </ScrollScreen>
  );
}
