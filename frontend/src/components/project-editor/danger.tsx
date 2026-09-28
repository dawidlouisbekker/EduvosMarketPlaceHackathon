import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '../button';
import { Section } from '../section';
import { editorStyles, ErrorText, Hint, useAction } from './shared';

import { deleteProject } from '@/api';
import type { ProjectDetail } from '@/types/models';

/** Two-step delete (Alert.alert doesn't work on web). */
export function DangerSection({ project }: { project: ProjectDetail }) {
  const { run, error, busy } = useAction();
  const [confirming, setConfirming] = useState(false);

  const remove = async () => {
    if (!(await run(() => deleteProject(project.id)))) return;
    if (router.canDismiss()) router.dismissAll();
    router.replace('/projects');
  };

  return (
    <Section title="Delete project">
      <Hint>
        Removes the project with its tasks, roles, team and videos. Ideas it was created from are kept. This can&apos;t be
        undone.
      </Hint>
      <View style={editorStyles.chips}>
        {confirming ? (
          <>
            <Button variant="danger" icon="trash" title="Tap again to delete" loading={busy} onPress={remove} />
            <Button variant="secondary" title="Cancel" onPress={() => setConfirming(false)} />
          </>
        ) : (
          <Button variant="danger" icon="trash" title="Delete project" onPress={() => setConfirming(true)} />
        )}
      </View>
      <ErrorText error={error} />
    </Section>
  );
}
