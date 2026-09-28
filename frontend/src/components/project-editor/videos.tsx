import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { Section } from '../section';
import { ThemedText } from '../themed-text';
import { AddRow, editorStyles, ErrorText, Hint, IconButton, useAction } from './shared';

import { addMedia, removeMedia } from '@/api';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ProjectDetail } from '@/types/models';
import { youtubeId, youtubeThumbnail } from '@/utils/youtube';

/** YouTube links shown on the project page (when "Show videos" is on). */
export function VideosSection({ project }: { project: ProjectDetail }) {
  const theme = useTheme();
  const { run, error, busy } = useAction();

  return (
    <Section title={`Videos · ${project.media.length}`}>
      {!project.show_media && project.media.length > 0 && (
        <Hint>Videos are hidden on the project page. Turn on &quot;Show videos&quot; in Details.</Hint>
      )}
      {project.media.map((m) => {
        const vid = youtubeId(m.url);
        return (
          <View key={m.id} style={[editorStyles.row, styles.video, { backgroundColor: theme.backgroundElement }]}>
            {vid ? (
              <Image source={youtubeThumbnail(vid)} style={styles.thumb} contentFit="cover" />
            ) : (
              <View style={[styles.thumb, { backgroundColor: theme.backgroundSelected }]} />
            )}
            <ThemedText type="small" numberOfLines={2} style={editorStyles.flex}>
              {m.url}
            </ThemedText>
            <IconButton icon="trash" label="Remove video" danger onPress={() => run(() => removeMedia(project.id, m.id))} />
          </View>
        );
      })}
      <AddRow
        placeholder="https://www.youtube.com/watch?v=…"
        maxLength={2048}
        busy={busy}
        onSubmit={(url) => run(() => addMedia(project.id, url))}
      />
      <ErrorText error={error} />
    </Section>
  );
}

const styles = StyleSheet.create({
  video: { borderRadius: Spacing.three, padding: Spacing.two },
  thumb: { width: 96, aspectRatio: 16 / 9, borderRadius: Spacing.two },
});
