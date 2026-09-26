import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AuthorRow } from '@/components/author-row';
import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { CommentComposer, CommentThread } from '@/components/comment-thread';
import { Icon } from '@/components/icon';
import { ScrollScreen } from '@/components/scroll-screen';
import { Section } from '@/components/section';
import { ThemedText } from '@/components/themed-text';
import { Stat, VoteButton } from '@/components/vote-button';
import { Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { getCommentTypes, getComments, getIdea, getMyProspects, setIdeaShares, toggleIdeaVote } from '@/mock/api';
import type { IdeaDetail } from '@/types/models';

export default function IdeaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { data: idea, loading } = useQuery(`idea:${id}`, () => getIdea(id));
  const { data: comments } = useQuery(`comments:${id}`, () => getComments(id));
  const { data: types } = useQuery('comment-types', getCommentTypes);

  if (!idea) {
    return (
      <ScrollScreen>
        {loading ? (
          <ActivityIndicator />
        ) : (
          <ThemedText themeColor="textSecondary">This idea does not exist or is private.</ThemedText>
        )}
      </ScrollScreen>
    );
  }

  return (
    <ScrollScreen>
      <View style={styles.head}>
        <AuthorRow
          user={idea.author}
          createdAt={idea.created_at}
          right={
            <Chip
              icon={idea.visibility === 'private' ? 'lock' : 'public'}
              label={idea.visibility === 'private' ? 'Private' : 'Public'}
            />
          }
        />
        <ThemedText style={styles.title}>{idea.title}</ThemedText>
        <ThemedText>{idea.description}</ThemedText>
        <View style={styles.row}>
          <VoteButton count={idea.vote_count} active={idea.viewer_voted} onToggle={() => toggleIdeaVote(idea.id)} />
          <Stat icon="comment" value={idea.comment_count} />
        </View>
      </View>

      {idea.problems.length > 0 && (
        <Section title="Solves">
          {idea.problems.map((p) => (
            <Pressable
              key={p.problem_id}
              onPress={() => router.push({ pathname: '/problem/[id]', params: { id: p.problem_id } })}
              style={({ pressed }) => [styles.link, { backgroundColor: theme.backgroundElement }, pressed && { opacity: 0.7 }]}>
              <Icon name="problem" size={18} color={theme.danger} />
              <View style={styles.flex}>
                <ThemedText type="smallBold">{p.problem_title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {p.description}
                </ThemedText>
              </View>
              <Icon name="chevron" size={14} color={theme.textSecondary} />
            </Pressable>
          ))}
        </Section>
      )}

      {idea.project_id ? (
        <Pressable
          onPress={() => router.push({ pathname: '/project/[id]', params: { id: idea.project_id! } })}
          style={({ pressed }) => [styles.link, { backgroundColor: `${theme.success}1f` }, pressed && { opacity: 0.7 }]}>
          <Icon name="project" size={18} color={theme.success} />
          <ThemedText type="smallBold" style={styles.flex}>
            Being built as {idea.project_name}
          </ThemedText>
          <Icon name="chevron" size={14} color={theme.textSecondary} />
        </Pressable>
      ) : (
        idea.is_owner && (
          <Button
            icon="project"
            title="Turn into a project"
            onPress={() => router.push({ pathname: '/compose/project', params: { ideaId: idea.id } })}
          />
        )
      )}

      {idea.is_owner && idea.visibility === 'private' && <SharePanel idea={idea} />}

      <Section title={`Comments · ${idea.comment_count}`}>
        {types && <CommentComposer ideaId={idea.id} parentId={null} types={types} />}
        {!comments || !types ? (
          <ActivityIndicator />
        ) : comments.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No comments yet. Give the first feedback.
          </ThemedText>
        ) : (
          <CommentThread ideaId={idea.id} comments={comments} types={types} />
        )}
      </Section>
    </ScrollScreen>
  );
}

/** Owner of a private idea picks which prospects can see it (idea_shares). */
function SharePanel({ idea }: { idea: IdeaDetail }) {
  const theme = useTheme();
  const { data: prospects } = useQuery('my-prospects', getMyProspects);
  const [open, setOpen] = useState(false);
  const shared = new Set(idea.shared_with.map((u) => u.id));

  const toggle = (userId: string) => {
    const next = new Set(shared);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    setIdeaShares(idea.id, [...next]);
  };

  return (
    <Section
      title={`Shared with · ${idea.shared_with.length}`}
      right={<Button small variant="secondary" icon="share" title={open ? 'Done' : 'Manage'} onPress={() => setOpen((o) => !o)} />}>
      {!open ? (
        <ThemedText type="small" themeColor="textSecondary">
          {idea.shared_with.length
            ? idea.shared_with.map((u) => u.display_name).join(', ')
            : 'Only you can see this idea. Share it with your prospects.'}
        </ThemedText>
      ) : prospects?.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          You have no prospects yet. Add people as prospects from their profile first.
        </ThemedText>
      ) : (
        prospects?.map((u) => (
          <Pressable key={u.id} onPress={() => toggle(u.id)} style={styles.shareRow}>
            <Avatar user={u} size={32} />
            <ThemedText type="small" style={styles.flex}>
              {u.display_name}
            </ThemedText>
            <Icon name={shared.has(u.id) ? 'check' : 'circle'} size={20} color={shared.has(u.id) ? theme.accent : theme.textSecondary} />
          </Pressable>
        ))
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  head: { gap: Spacing.three },
  title: { fontSize: 24, lineHeight: 30, fontWeight: 800 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  flex: { flex: 1 },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.one },
});
