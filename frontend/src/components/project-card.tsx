import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AuthorRow } from './author-row';
import { AvatarStack } from './avatar';
import { Card } from './card';
import { Chip } from './chip';
import { Icon } from './icon';
import { ProgressBar } from './progress-bar';
import { ThemedText } from './themed-text';
import { Stat } from './vote-button';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { FeedProject } from '@/types/models';
import { timeUntil } from '@/utils/time';

export function ProjectCard({ project }: { project: FeedProject }) {
  const theme = useTheme();
  const due = project.deadline ? timeUntil(project.deadline) : null;
  return (
    <Card onPress={() => router.push({ pathname: '/project/[id]', params: { id: project.id } })}>
      <AuthorRow
        user={project.owner}
        createdAt={project.created_at}
        right={project.visibility === 'private' && <Icon name="lock" size={14} color={theme.textSecondary} />}
      />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <ThemedText type="default" style={styles.title}>
            {project.name}
          </ThemedText>
          {project.media_count > 0 && <Icon name="play" size={16} color={theme.danger} />}
        </View>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {project.description}
        </ThemedText>
      </View>

      {project.task_total > 0 && (
        <View style={styles.progress}>
          <ProgressBar value={project.task_done} total={project.task_total} />
          <ThemedText type="small" themeColor="textSecondary">
            {project.task_done}/{project.task_total} tasks
          </ThemedText>
        </View>
      )}

      {project.open_roles.length > 0 && (
        <View style={styles.chips}>
          <ThemedText type="small" themeColor="textSecondary">
            Looking for
          </ThemedText>
          {project.open_roles.map((r) => (
            <Chip key={r} label={r} selected />
          ))}
        </View>
      )}

      <View style={styles.footer}>
        <AvatarStack users={[project.owner, ...project.participants]} />
        {due && (
          <View style={styles.due}>
            <Icon name="clock" size={13} color={due.overdue ? theme.danger : theme.textSecondary} />
            <ThemedText type="small" style={{ color: due.overdue ? theme.danger : theme.textSecondary }}>
              {due.label}
            </ThemedText>
          </View>
        )}
        <Stat icon="team" value={project.participants.length + 1} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.one },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { fontWeight: 700, flexShrink: 1 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.one + 2 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  due: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, marginLeft: 'auto' },
});
