import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { CategoriesSection } from '@/components/project-editor/categories';
import { DangerSection } from '@/components/project-editor/danger';
import { DetailsSection } from '@/components/project-editor/details';
import { RolesSection } from '@/components/project-editor/roles';
import { TasksSection } from '@/components/project-editor/tasks';
import { TeamSection } from '@/components/project-editor/team';
import { VideosSection } from '@/components/project-editor/videos';
import { ScrollScreen } from '@/components/scroll-screen';
import { ThemedText } from '@/components/themed-text';
import { getProject } from '@/api';
import { useQuery } from '@/hooks/use-query';
import { ViewerRelation } from '@/types/models';

/**
 * Owner-only editor, opened from "Edit project" on the project page. Details are saved with a button; everything
 * else is saved as soon as it changes, and the project page behind this modal refreshes too.
 */
export default function EditProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: project, loading } = useQuery(`project:${id}`, () => getProject(id));

  if (!project) {
    return (
      <ScrollScreen>
        {loading ? <ActivityIndicator /> : <ThemedText themeColor="textSecondary">This project does not exist.</ThemedText>}
      </ScrollScreen>
    );
  }
  if (project.viewer_relation !== ViewerRelation.OWNER) {
    return (
      <ScrollScreen>
        <ThemedText themeColor="textSecondary">Only the owner can edit this project.</ThemedText>
      </ScrollScreen>
    );
  }

  return (
    <ScrollScreen>
      {/* Remount after a save so the form starts from the saved values. */}
      <DetailsSection key={project.updated_at} project={project} />
      <VideosSection project={project} />
      <CategoriesSection project={project} />
      <RolesSection project={project} />
      <TasksSection project={project} />
      <TeamSection project={project} />
      <DangerSection project={project} />
    </ScrollScreen>
  );
}
