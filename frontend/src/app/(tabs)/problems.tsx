import { router } from 'expo-router';
import { useState } from 'react';

import { Fab } from '@/components/fab';
import { Feed } from '@/components/feed';
import { ProblemCard } from '@/components/problem-card';
import { ScreenHeader } from '@/components/screen-header';
import { SegmentedControl } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { getProblemFeed } from '@/mock/api';
import type { FeedSort } from '@/types/models';

export default function ProblemsScreen() {
  const [sort, setSort] = useState<FeedSort>('top');
  return (
    <ThemedView style={{ flex: 1 }}>
      <Feed
        queryKey={sort}
        load={(cursor, limit) => getProblemFeed(sort, cursor, limit)}
        renderItem={(p) => <ProblemCard problem={p} />}
        empty="No problems yet. What's bugging you on campus?"
        header={
          <ScreenHeader title="Problems">
            <ThemedText type="small" themeColor="textSecondary">
              Things students struggle with. Tap &quot;Me too&quot; if it bugs you as well.
            </ThemedText>
            <SegmentedControl
              value={sort}
              onChange={setSort}
              options={[
                { value: 'top', label: 'Most felt' },
                { value: 'new', label: 'New' },
              ]}
            />
          </ScreenHeader>
        }
      />
      <Fab label="Post a problem" onPress={() => router.push('/compose/problem')} />
    </ThemedView>
  );
}
