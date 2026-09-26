import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AuthorRow } from './author-row';
import { Card } from './card';
import { ThemedText } from './themed-text';
import { Stat, VoteButton } from './vote-button';

import { Spacing } from '@/constants/theme';
import { toggleProblemVote } from '@/api';
import type { FeedProblem } from '@/types/models';

export function ProblemCard({ problem }: { problem: FeedProblem }) {
  return (
    <Card onPress={() => router.push({ pathname: '/problem/[id]', params: { id: problem.id } })}>
      <AuthorRow user={problem.author} createdAt={problem.created_at} />
      <View style={styles.body}>
        <ThemedText type="default" style={styles.title}>
          {problem.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
          {problem.description}
        </ThemedText>
      </View>
      <View style={styles.actions}>
        <VoteButton
          icon="metoo"
          label="Me too"
          count={problem.vote_count}
          active={problem.viewer_voted}
          onToggle={() => toggleProblemVote(problem.id, problem.viewer_voted)}
        />
        <Stat icon="idea" value={`${problem.idea_count} idea${problem.idea_count === 1 ? '' : 's'}`} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.one },
  title: { fontWeight: 700 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
