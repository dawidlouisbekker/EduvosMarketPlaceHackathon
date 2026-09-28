import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from './avatar';
import { Icon } from './icon';
import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { UserSummary } from '@/types/models';
import { timeAgo } from '@/utils/time';

/** "(avatar) Name ✓ · 3h" header of a post. Tapping it opens the author's profile. No user = deleted account. */
export function AuthorRow({ user, createdAt, right }: { user?: UserSummary; createdAt?: string; right?: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Pressable
        style={({ pressed }) => [styles.author, pressed && { opacity: 0.7 }]}
        disabled={!user}
        onPress={() => user && router.push({ pathname: '/user/[id]', params: { id: user.id } })}>
        <Avatar user={user} size={32} />
        <View style={styles.flex}>
          <View style={styles.nameRow}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {user?.display_name ?? '[deleted]'}
            </ThemedText>
            {user?.is_entrepreneur && <Icon name="verified" size={13} color={theme.warning} />}
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
            {timeAgo(createdAt)}
          </ThemedText>
        </View>
      </Pressable>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  author: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flex: 1 },
  flex: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  meta: { fontSize: 12, lineHeight: 16 },
});
