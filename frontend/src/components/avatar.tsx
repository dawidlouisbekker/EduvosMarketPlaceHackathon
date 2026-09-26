import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import type { UserSummary } from '@/types/models';

const PALETTE = ['#3C87F7', '#8E4EC6', '#30A46C', '#E5484D', '#F76B15', '#0D9488', '#D6409F', '#6E56CF'];

function colorFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Profile photo, or coloured initials when users.avatar_url is NULL. `null` user = deleted account. */
export function Avatar({ user, size = 36 }: { user: Pick<UserSummary, 'id' | 'display_name' | 'avatar_url'> | null; size?: number }) {
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (user?.avatar_url) return <Image source={user.avatar_url} style={box} contentFit="cover" />;
  return (
    <View style={[styles.fallback, box, { backgroundColor: user ? colorFor(user.id) : '#8B8D98' }]}>
      <Text style={[styles.text, { fontSize: size * 0.4 }]}>{user ? initials(user.display_name) : '?'}</Text>
    </View>
  );
}

/** Overlapping avatars, e.g. a project's team. */
export function AvatarStack({ users, size = 24, max = 4 }: { users: UserSummary[]; size?: number; max?: number }) {
  const shown = users.slice(0, max);
  return (
    <View style={styles.stack}>
      {shown.map((u, i) => (
        <View key={u.id} style={[styles.ring, { marginLeft: i ? -size / 3 : 0, borderRadius: size }]}>
          <Avatar user={u} size={size} />
        </View>
      ))}
      {users.length > max && (
        <View style={[styles.fallback, styles.more, { width: size, height: size, borderRadius: size / 2, marginLeft: -size / 3 }]}>
          <Text style={[styles.text, { fontSize: size * 0.38 }]}>+{users.length - max}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  text: { color: '#fff', fontWeight: 700 },
  stack: { flexDirection: 'row', alignItems: 'center' },
  ring: { borderWidth: 2, borderColor: 'transparent' },
  more: { backgroundColor: '#8B8D98' },
});
