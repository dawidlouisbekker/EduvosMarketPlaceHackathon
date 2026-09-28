import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AuthorRow } from './author-row';
import { Card } from './card';
import { Chip } from './chip';
import { Icon } from './icon';
import { ThemedText } from './themed-text';
import { Stat, VoteButton } from './vote-button';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { toggleIdeaVote } from '@/api';
import { Visibility, type FeedIdea } from '@/types/models';

export function IdeaCard({ idea }: { idea: FeedIdea }) {
  const theme = useTheme();
  return (
    <Card onPress={() => router.push({ pathname: '/idea/[id]', params: { id: idea.id } })}>
      <AuthorRow
        user={idea.author}
        createdAt={idea.created_at}
        right={idea.visibility === Visibility.PRIVATE && <Icon name="lock" size={14} color={theme.textSecondary} />}
      />
      <View style={styles.body}>
        <ThemedText type="default" style={styles.title}>
          {idea.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
          {idea.description}
        </ThemedText>
      </View>
      {(idea.problems.length > 0 || idea.project_name) && (
        <View style={styles.chips}>
          {idea.problems.map((p) => (
            <Chip
              key={p.problem_id}
              icon="problem"
              label={`Solves: ${p.problem_title}`}
              onPress={() => router.push({ pathname: '/problem/[id]', params: { id: p.problem_id } })}
            />
          ))}
          {idea.project_id && idea.project_name && (
            <Chip
              icon="project"
              label={idea.project_name}
              color={theme.success}
              onPress={() => router.push({ pathname: '/project/[id]', params: { id: idea.project_id! } })}
            />
          )}
        </View>
      )}
      <View style={styles.actions}>
        <VoteButton count={idea.vote_count} active={idea.viewer_voted} onToggle={() => toggleIdeaVote(idea.id, idea.viewer_voted)} />
        <Stat icon="comment" value={idea.comment_count} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.one },
  title: { fontWeight: 700 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one + 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
