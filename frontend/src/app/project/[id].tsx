import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AuthorRow } from '@/components/author-row';
import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ExternalLink } from '@/components/external-link';
import { Icon } from '@/components/icon';
import { ProgressBar } from '@/components/progress-bar';
import { ScrollScreen } from '@/components/scroll-screen';
import { Section } from '@/components/section';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { getProject, respondToInvite, respondToJoinRequest, toggleJoinRequest, toggleTask } from '@/mock/api';
import type { ProjectDetail } from '@/types/models';
import { shortDate, timeUntil } from '@/utils/time';

function youtubeId(url: string) {
  return url.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/)?.[1] ?? null;
}

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { data: project, loading } = useQuery(`project:${id}`, () => getProject(id));

  if (!project) {
    return (
      <ScrollScreen>
        {loading ? (
          <ActivityIndicator />
        ) : (
          <ThemedText themeColor="textSecondary">This project does not exist or is private.</ThemedText>
        )}
      </ScrollScreen>
    );
  }

  const due = project.deadline ? timeUntil(project.deadline) : null;
  const categoryName = new Map(project.categories.map((c) => [c.id, c.name]));
  const roleName = new Map(project.roles.map((r) => [r.id, r.name]));
  const canEditTasks = project.viewer_relation === 'owner' || project.viewer_relation === 'participant';

  return (
    <ScrollScreen>
      <View style={styles.head}>
        <AuthorRow
          user={project.owner}
          createdAt={project.created_at}
          right={
            <Chip
              icon={project.visibility === 'private' ? 'lock' : 'public'}
              label={project.visibility === 'private' ? 'Private' : 'Public'}
            />
          }
        />
        <ThemedText style={styles.title}>{project.name}</ThemedText>
        <ThemedText>{project.description}</ThemedText>
        <View style={styles.metaRow}>
          {due && (
            <Chip icon="clock" label={`Due ${shortDate(project.deadline!)} · ${due.label}`} color={due.overdue ? theme.danger : undefined} />
          )}
          {project.source_idea && (
            <Chip
              icon="idea"
              label={`From idea: ${project.source_idea.title}`}
              onPress={() => router.push({ pathname: '/idea/[id]', params: { id: project.source_idea!.id } })}
            />
          )}
        </View>
        <JoinAction project={project} />
      </View>

      {project.media.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.media}>
          {project.media.map((m) => {
            const vid = youtubeId(m.url);
            return (
              <ExternalLink key={m.id} href={m.url as `https://${string}`} asChild>
                <Pressable style={styles.thumbWrap}>
                  {vid && <Image source={`https://img.youtube.com/vi/${vid}/hqdefault.jpg`} style={styles.thumb} contentFit="cover" />}
                  <View style={styles.play}>
                    <Icon name="play" size={36} color="#fff" />
                  </View>
                </Pressable>
              </ExternalLink>
            );
          })}
        </ScrollView>
      )}

      {project.join_requests.length > 0 && (
        <Section title={`Join requests · ${project.join_requests.length}`}>
          {project.join_requests.map((u) => (
            <View key={u.id} style={[styles.personRow, { backgroundColor: theme.accentSoft }]}>
              <Pressable onPress={() => router.push({ pathname: '/user/[id]', params: { id: u.id } })}>
                <Avatar user={u} size={36} />
              </Pressable>
              <View style={styles.flex}>
                <ThemedText type="smallBold">{u.display_name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {u.bio}
                </ThemedText>
                <View style={[styles.metaRow, styles.requestActions]}>
                  <Button small title="Accept" onPress={() => respondToJoinRequest(project.id, u.id, true)} />
                  <Button small variant="secondary" title="Decline" onPress={() => respondToJoinRequest(project.id, u.id, false)} />
                </View>
              </View>
            </View>
          ))}
        </Section>
      )}

      <Section title={`Roadmap · ${project.task_done}/${project.task_total}`}>
        {project.task_total > 0 && <ProgressBar value={project.task_done} total={project.task_total} />}
        {project.tasks.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No tasks yet.
          </ThemedText>
        ) : (
          <View>
            {project.tasks.map((t, i) => {
              const taskDue = timeUntil(t.deadline);
              return (
                <View key={t.id} style={styles.task}>
                  <View style={styles.rail}>
                    <Pressable disabled={!canEditTasks} onPress={() => toggleTask(t.id)} hitSlop={8}>
                      <Icon name={t.completed ? 'check' : 'circle'} size={22} color={t.completed ? theme.success : theme.textSecondary} />
                    </Pressable>
                    {i < project.tasks.length - 1 && <View style={[styles.line, { backgroundColor: theme.border }]} />}
                  </View>
                  <View style={styles.taskBody}>
                    <ThemedText
                      type="small"
                      themeColor={t.completed ? 'textSecondary' : 'text'}
                      style={t.completed && styles.strike}>
                      {t.description}
                    </ThemedText>
                    <View style={styles.metaRow}>
                      {t.category_ids.map((c) => (
                        <Chip key={c} label={categoryName.get(c) ?? '?'} />
                      ))}
                      <ThemedText
                        type="small"
                        style={[styles.tiny, { color: !t.completed && taskDue.overdue ? theme.danger : theme.textSecondary }]}>
                        {shortDate(t.deadline)}
                      </ThemedText>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </Section>

      <Section title={`Team · ${project.team.length}`}>
        {project.team.map((m, i) => (
          <Pressable
            key={m.user.id}
            onPress={() => router.push({ pathname: '/user/[id]', params: { id: m.user.id } })}
            style={styles.personRow}>
            <Avatar user={m.user} size={36} />
            <View style={styles.flex}>
              <ThemedText type="smallBold">{m.user.display_name}</ThemedText>
              <View style={styles.metaRow}>
                {i === 0 && <Chip label="Owner" color={theme.warning} />}
                {m.role_ids.map((r) => (
                  <Chip key={r} label={roleName.get(r) ?? '?'} selected />
                ))}
              </View>
            </View>
          </Pressable>
        ))}
      </Section>

      {project.roles.length > 0 && (
        <Section title="Roles">
          {project.roles.map((r) => {
            const open = project.open_roles.includes(r.name);
            return (
              <View key={r.id} style={[styles.role, { borderColor: theme.border }]}>
                <View style={styles.roleHead}>
                  <ThemedText type="smallBold">{r.name}</ThemedText>
                  {open && <Chip label="Open" color={theme.success} />}
                </View>
                {r.category_ids.length > 0 && (
                  <ThemedText type="small" themeColor="textSecondary">
                    Covers {r.category_ids.map((c) => categoryName.get(c)).join(', ')}
                  </ThemedText>
                )}
              </View>
            );
          })}
        </Section>
      )}
    </ScrollScreen>
  );
}

/** The main call to action, depending on how the viewer relates to the project. */
function JoinAction({ project }: { project: ProjectDetail }) {
  switch (project.viewer_relation) {
    case 'owner':
      return (
        <ThemedText type="small" themeColor="textSecondary">
          You own this project. Task, role and invite editing comes with the API.
        </ThemedText>
      );
    case 'participant':
      return <Chip icon="check" label="You are on this team" selected />;
    case 'invited':
      return (
        <View style={styles.metaRow}>
          <Button title="Accept invite" onPress={() => respondToInvite(project.id, true)} />
          <Button variant="secondary" title="Decline" onPress={() => respondToInvite(project.id, false)} />
        </View>
      );
    case 'requested':
      return <Button variant="secondary" icon="clock" title="Request sent · cancel" onPress={() => toggleJoinRequest(project.id)} />;
    case 'none':
      return <Button icon="personAdd" title="Request to join" onPress={() => toggleJoinRequest(project.id)} />;
  }
}

const styles = StyleSheet.create({
  head: { gap: Spacing.three },
  title: { fontSize: 24, lineHeight: 30, fontWeight: 800 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.one + 2 },
  flex: { flex: 1, gap: Spacing.half },
  media: { gap: Spacing.three },
  thumbWrap: { width: 280, aspectRatio: 16 / 9, borderRadius: Spacing.three, overflow: 'hidden', backgroundColor: '#000' },
  thumb: { width: '100%', height: '100%' },
  play: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  requestActions: { marginTop: Spacing.one },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.two, borderRadius: Spacing.three },
  task: { flexDirection: 'row', gap: Spacing.three },
  rail: { alignItems: 'center', width: 22 },
  line: { width: 2, flex: 1, marginVertical: Spacing.half },
  taskBody: { flex: 1, gap: Spacing.one, paddingBottom: Spacing.three },
  strike: { textDecorationLine: 'line-through' },
  tiny: { fontSize: 12 },
  role: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  roleHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
