import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '../button';
import { Chip } from '../chip';
import { DeadlineField, TextField } from '../form';
import { Icon } from '../icon';
import { Section } from '../section';
import { ThemedText } from '../themed-text';
import { CategoryPicker, editorStyles, ErrorText, Hint, IconButton, toggled, useAction } from './shared';

import { addTask, editTask, removeTask, reorderTasks } from '@/api';
import { useTheme } from '@/hooks/use-theme';
import type { ProjectCategory, ProjectDetail, ProjectTask } from '@/types/models';
import { shortDate } from '@/utils/time';

/** The roadmap: tasks in order, each with a deadline and at least one category. */
export function TasksSection({ project }: { project: ProjectDetail }) {
  const theme = useTheme();
  const { run, error, busy } = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const categoryName = new Map(project.categories.map((c) => [c.id, c.name]));
  const tasks = [...project.tasks].sort((a, b) => a.position - b.position);

  const move = (index: number, by: -1 | 1) => {
    const ids = tasks.map((t) => t.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    run(() => reorderTasks(project.id, ids));
  };

  return (
    <Section title={`Tasks · ${tasks.length}`}>
      {tasks.map((task, i) =>
        editing === task.id ? (
          <TaskForm
            key={task.id}
            categories={project.categories}
            task={task}
            busy={busy}
            submitTitle="Save task"
            onCancel={() => setEditing(null)}
            onSubmit={async (t) => {
              const ok = await run(() => editTask(project.id, task.id, t));
              if (ok) setEditing(null);
              return ok;
            }}
          />
        ) : (
          <View key={task.id} style={[editorStyles.card, { backgroundColor: theme.backgroundElement }]}>
            <View style={editorStyles.row}>
              <Icon name={task.completed ? 'check' : 'circle'} size={18} color={task.completed ? theme.success : theme.textSecondary} />
              <ThemedText type="small" style={editorStyles.flex}>
                {task.description}
              </ThemedText>
              <IconButton icon="up" label="Move up" disabled={i === 0 || busy} onPress={() => move(i, -1)} />
              <IconButton icon="down" label="Move down" disabled={i === tasks.length - 1 || busy} onPress={() => move(i, 1)} />
              <IconButton icon="edit" label="Edit task" onPress={() => setEditing(task.id)} />
              <IconButton icon="trash" label="Remove task" danger onPress={() => run(() => removeTask(project.id, task.id))} />
            </View>
            <View style={editorStyles.chips}>
              {task.category_ids.map((c) => (
                <Chip key={c} label={categoryName.get(c) ?? '?'} />
              ))}
              <Chip icon="clock" label={shortDate(task.deadline)} />
            </View>
          </View>
        ),
      )}
      <ErrorText error={error} />
      <ThemedText type="smallBold">Add a task</ThemedText>
      <TaskForm
        categories={project.categories}
        busy={busy}
        submitTitle="Add task"
        onSubmit={(t) => run(() => addTask(project.id, { ...t, deadline: t.deadline! }))}
      />
    </Section>
  );
}

type TaskInput = { description: string; deadline?: string; categoryIds: string[] };

/** Add a task (no `task`), or edit one. Only changed fields are submitted when editing. */
function TaskForm({
  categories,
  task,
  busy,
  submitTitle,
  onSubmit,
  onCancel,
}: {
  categories: ProjectCategory[];
  task?: ProjectTask;
  busy: boolean;
  submitTitle: string;
  onSubmit: (task: TaskInput) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const theme = useTheme();
  const [description, setDescription] = useState(task?.description ?? '');
  const [deadline, setDeadline] = useState<string | null>(task?.deadline ?? null);
  const [categoryIds, setCategoryIds] = useState<string[]>(task?.category_ids ?? []);
  // Bumped after adding a task, to reset the deadline chips.
  const [resets, setResets] = useState(0);
  const valid = description.trim().length > 0 && deadline !== null && categoryIds.length > 0;

  const submit = async () => {
    const ok = await onSubmit({
      description: description.trim(),
      deadline: deadline !== task?.deadline ? (deadline ?? undefined) : undefined,
      categoryIds,
    });
    if (ok && !task) {
      setDescription('');
      setDeadline(null);
      setCategoryIds([]);
      setResets((n) => n + 1);
    }
  };

  return (
    <View style={[editorStyles.card, { borderColor: theme.border, borderWidth: 1 }]}>
      <TextField label="Task" maxLength={1024} value={description} onChangeText={setDescription} placeholder="What needs to be done?" />
      <DeadlineField
        key={resets}
        value={deadline}
        initial={task?.deadline}
        onChange={setDeadline}
      />
      <ThemedText type="smallBold">Categories</ThemedText>
      <CategoryPicker categories={categories} selected={categoryIds} onToggle={(c) => setCategoryIds((ids) => toggled(ids, c))} />
      {!valid && categories.length > 0 && <Hint>A task needs a description, a deadline and at least one category.</Hint>}
      <View style={editorStyles.chips}>
        <Button small icon={task ? 'check' : 'add'} title={submitTitle} disabled={!valid} loading={busy} onPress={submit} />
        {onCancel && <Button small variant="secondary" title="Cancel" onPress={onCancel} />}
      </View>
    </View>
  );
}
