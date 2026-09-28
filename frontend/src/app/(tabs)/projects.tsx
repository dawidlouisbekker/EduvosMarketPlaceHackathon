import { router } from 'expo-router';
import { useState } from 'react';

import { Fab } from '@/components/fab';
import { Feed } from '@/components/feed';
import { ProjectCard } from '@/components/project-card';
import { ScreenHeader } from '@/components/screen-header';
import { SegmentedControl } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { getProjectFeed } from '@/api';
import type { ProjectSort } from '@/types/models';

export default function ProjectsScreen() {
  const [sort, setSort] = useState<ProjectSort>('new');
  return (
    <ThemedView style={{ flex: 1 }}>
      <Feed
        queryKey={sort}
        load={(cursor, limit) => getProjectFeed(sort, cursor, limit)}
        renderItem={(p) => <ProjectCard project={p} />}
        empty={sort === 'open_roles' ? 'No projects are looking for people right now.' : 'No projects yet.'}
        header={
          <ScreenHeader title="Projects">
            <ThemedText type="small" themeColor="textSecondary">
              Ideas being built. Find a team that needs your skills.
            </ThemedText>
            <SegmentedControl
              value={sort}
              onChange={setSort}
              options={[
                { value: 'new', label: 'New' },
                { value: 'open_roles', label: 'Looking for people' },
              ]}
            />
          </ScreenHeader>
        }
      />
      <Fab label="Start a project" onPress={() => router.push('/compose/project')} />
    </ThemedView>
  );
}
