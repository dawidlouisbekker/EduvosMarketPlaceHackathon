import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '../button';
import { Chip } from '../chip';
import { Section } from '../section';
import { ThemedText } from '../themed-text';
import { AddRow, CategoryPicker, editorStyles, ErrorText, Hint, IconButton, Input, toggled, useAction } from './shared';

import { addRole, removeRole, updateRole } from '@/api';
import { useTheme } from '@/hooks/use-theme';
import type { ProjectDetail, ProjectRole } from '@/types/models';

/** Roles people hold in the project, and the categories each covers. Assign them in Team. */
export function RolesSection({ project }: { project: ProjectDetail }) {
  const theme = useTheme();
  const { run, error, busy } = useAction();

  const holders = (roleId: string) =>
    project.team.filter((m) => m.role_ids.includes(roleId)).map((m) => m.user?.display_name ?? '[deleted]');

  return (
    <Section title={`Roles · ${project.roles.length}`}>
      <Hint>Roles nobody holds yet are shown as open on the project page. Assign roles in Team.</Hint>
      {project.roles.map((role) => (
        <View key={role.id} style={[editorStyles.card, { backgroundColor: theme.backgroundElement }]}>
          <RoleName
            role={role}
            onRename={(name) => run(() => updateRole(project.id, role.id, { name }))}
            onRemove={() => run(() => removeRole(project.id, role.id))}
          />
          <CategoryPicker
            categories={project.categories}
            selected={role.category_ids}
            onToggle={(c) => run(() => updateRole(project.id, role.id, { categoryIds: toggled(role.category_ids, c) }))}
          />
          <View style={editorStyles.chips}>
            {holders(role.id).length === 0 ? (
              <Chip label="Open" color={theme.success} />
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                Held by {holders(role.id).join(', ')}
              </ThemedText>
            )}
          </View>
        </View>
      ))}
      <AddRow placeholder="New role, e.g. Designer" maxLength={64} busy={busy} onSubmit={(name) => run(() => addRole(project.id, name, []))} />
      <ErrorText error={error} />
    </Section>
  );
}

function RoleName({ role, onRename, onRemove }: { role: ProjectRole; onRename: (name: string) => Promise<boolean>; onRemove: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(role.name);

  if (editing) {
    return (
      <View style={editorStyles.row}>
        <Input value={name} onChangeText={setName} maxLength={64} autoFocus style={editorStyles.flex} />
        <Button
          small
          title="Save"
          disabled={!name.trim() || name.trim() === role.name}
          onPress={async () => {
            if (await onRename(name.trim())) setEditing(false);
          }}
        />
        <Button small variant="secondary" title="Cancel" onPress={() => setEditing(false)} />
      </View>
    );
  }
  return (
    <View style={editorStyles.row}>
      <ThemedText type="smallBold" style={editorStyles.flex}>
        {role.name}
      </ThemedText>
      <IconButton icon="edit" label="Rename role" onPress={() => setEditing(true)} />
      <IconButton icon="trash" label="Remove role" danger onPress={onRemove} />
    </View>
  );
}
