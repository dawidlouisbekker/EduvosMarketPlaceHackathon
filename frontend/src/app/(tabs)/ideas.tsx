import { router } from 'expo-router';
import { useState } from 'react';

import { Fab } from '@/components/fab';
import { Feed } from '@/components/feed';
import { IdeaCard } from '@/components/idea-card';
import { ScreenHeader } from '@/components/screen-header';
import { SegmentedControl } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { getIdeaFeed } from '@/api';
import type { FeedSort } from '@/types/models';

export default function IdeasScreen() {
  const [sort, setSort] = useState<FeedSort>('new');
  return (
    <ThemedView style={{ flex: 1 }}>
      <Feed
        queryKey={sort}
        load={(cursor, limit) => getIdeaFeed(sort, cursor, limit)}
        renderItem={(i) => <IdeaCard idea={i} />}
        empty="No ideas yet. Pick a problem and pitch a solution."
        header={
          <ScreenHeader title="Ideas">
            <ThemedText type="small" themeColor="textSecondary">
              Solutions to problems. Upvote the ones you would use, and give feedback in the comments.
            </ThemedText>
            <SegmentedControl
              value={sort}
              onChange={setSort}
              options={[
                { value: 'new', label: 'New' },
                { value: 'top', label: 'Top' },
              ]}
            />
          </ScreenHeader>
        }
      />
      <Fab label="Post an idea" onPress={() => router.push('/compose/idea')} />
    </ThemedView>
  );
}
