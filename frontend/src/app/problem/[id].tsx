import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AuthorRow } from '@/components/author-row';
import { Button } from '@/components/button';
import { IdeaCard } from '@/components/idea-card';
import { ScrollScreen } from '@/components/scroll-screen';
import { Section } from '@/components/section';
import { ThemedText } from '@/components/themed-text';
import { VoteButton } from '@/components/vote-button';
import { Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { getProblem, toggleProblemVote } from '@/api';

export default function ProblemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading } = useQuery(`problem:${id}`, () => getProblem(id));

  if (!data) {
    return (
      <ScrollScreen>
        {loading ? <ActivityIndicator /> : <ThemedText themeColor="textSecondary">Problem not found.</ThemedText>}
      </ScrollScreen>
    );
  }
  const { problem, ideas } = data;

  return (
    <ScrollScreen>
      <View style={styles.head}>
        <AuthorRow user={problem.author} createdAt={problem.created_at} />
        <ThemedText style={styles.title}>{problem.title}</ThemedText>
        <ThemedText>{problem.description}</ThemedText>
        <View style={styles.row}>
          <VoteButton
            icon="metoo"
            label="Me too"
            count={problem.vote_count}
            active={problem.viewer_voted}
            onToggle={() => toggleProblemVote(problem.id, problem.viewer_voted)}
          />
        </View>
      </View>

      <Section
        title={`Ideas that solve this · ${ideas.length}`}
        right={
          <Button
            small
            icon="idea"
            title="Propose an idea"
            onPress={() => router.push({ pathname: '/compose/idea', params: { problemId: problem.id } })}
          />
        }>
        {ideas.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No ideas yet. Be the first to propose a solution.
          </ThemedText>
        ) : (
          <View style={styles.list}>
            {ideas.map((i) => (
              <IdeaCard key={i.id} idea={i} />
            ))}
          </View>
        )}
      </Section>
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  head: { gap: Spacing.three },
  title: { fontSize: 24, lineHeight: 30, fontWeight: 800 },
  row: { flexDirection: 'row', gap: Spacing.three },
  list: { gap: Spacing.three },
});
