import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '../button';
import { Chip } from '../chip';
import { Section } from '../section';
import { AddRow, editorStyles, ErrorText, Hint, Input, useAction } from './shared';

import { addCategory, removeCategory, renameCategory } from '@/api';
import type { ProjectCategory, ProjectDetail } from '@/types/models';

/** Kinds of work in the project. Tasks are tagged with them and roles cover them. Tap one to rename or remove it. */
export function CategoriesSection({ project }: { project: ProjectDetail }) {
  const { run, error, busy } = useAction();
  const [editing, setEditing] = useState<ProjectCategory | null>(null);

  return (
    <Section title={`Categories · ${project.categories.length}`}>
      <Hint>Kinds of work, e.g. Design or Marketing. Tasks are tagged with them and roles cover them.</Hint>
      {project.categories.length > 0 && (
        <View style={editorStyles.chips}>
          {project.categories.map((c) => (
            <Chip key={c.id} label={c.name} selected={editing?.id === c.id} onPress={() => setEditing(editing?.id === c.id ? null : c)} />
          ))}
        </View>
      )}
      {editing && (
        <CategoryEditor
          key={editing.id}
          category={editing}
          busy={busy}
          onRename={async (name) => {
            if (await run(() => renameCategory(project.id, editing.id, name))) setEditing(null);
          }}
          onRemove={async () => {
            if (await run(() => removeCategory(project.id, editing.id))) setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      <AddRow placeholder="New category" maxLength={64} busy={busy} onSubmit={(name) => run(() => addCategory(project.id, name))} />
      <ErrorText error={error} />
    </Section>
  );
}

function CategoryEditor({
  category,
  busy,
  onRename,
  onRemove,
  onCancel,
}: {
  category: ProjectCategory;
  busy: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(category.name);
  const valid = name.trim() && name.trim() !== category.name;
  return (
    <View style={editorStyles.card}>
      <Input value={name} onChangeText={setName} maxLength={64} autoFocus />
      <View style={editorStyles.chips}>
        <Button small title="Rename" disabled={!valid} loading={busy} onPress={() => onRename(name.trim())} />
        <Button small variant="danger" icon="trash" title="Remove" onPress={onRemove} />
        <Button small variant="secondary" title="Cancel" onPress={onCancel} />
      </View>
    </View>
  );
}
