import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { ScreenHeader } from '@/components/screen-header';
import { ScrollScreen } from '@/components/scroll-screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { getNotifications, markAllRead, respondToInvite, respondToJoinRequest } from '@/mock/api';
import type { Notification } from '@/types/models';
import { timeAgo } from '@/utils/time';

function describe(n: Notification): string {
  const name = n.actor?.display_name ?? 'Someone';
  switch (n.kind) {
    case 'project_invite':
      return `${name} invited you to join ${n.project?.name}`;
    case 'join_request':
      return `${name} wants to join ${n.project?.name}`;
    case 'request_accepted':
      return `${name} accepted you into ${n.project?.name}`;
    case 'idea_comment':
      return `${name} commented on ${n.idea?.title}: "${n.comment?.excerpt}"`;
    case 'comment_reply':
      return `${name} replied to you: "${n.comment?.excerpt}"`;
    case 'skill_vouch':
      return `${name} vouched for one of your skills`;
    case 'idea_shared':
      return `${name} shared a private idea with you: ${n.idea?.title}`;
    case 'entrepreneur_vouch':
      return `${name} vouched that you are an entrepreneur for your work on ${n.project?.name}`;
  }
}

function open(n: Notification) {
  if (n.idea) router.push({ pathname: '/idea/[id]', params: { id: n.idea.id } });
  else if (n.project) router.push({ pathname: '/project/[id]', params: { id: n.project.id } });
  else if (n.kind === 'skill_vouch') router.push('/profile');
  else if (n.actor) router.push({ pathname: '/user/[id]', params: { id: n.actor.id } });
}

export default function InboxScreen() {
  const theme = useTheme();
  const { data } = useQuery('notifications', getNotifications);
  const hasUnread = data?.some((n) => !n.read_at);

  return (
    <ScrollScreen tab>
      <ScreenHeader
        title="Inbox"
        right={hasUnread && <Button small variant="secondary" title="Mark all read" onPress={markAllRead} />}
      />
      {!data ? (
        <ActivityIndicator />
      ) : data.length === 0 ? (
        <ThemedText themeColor="textSecondary">Nothing here yet.</ThemedText>
      ) : (
        <View style={styles.list}>
          {data.map((n) => (
            <Pressable key={n.id} onPress={() => open(n)} style={({ pressed }) => pressed && { opacity: 0.7 }}>
              <View style={[styles.row, !n.read_at && { backgroundColor: theme.accentSoft }]}>
                <Avatar user={n.actor} size={40} />
                <View style={styles.body}>
                  <ThemedText type="small">{describe(n)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.time}>
                    {timeAgo(n.created_at)}
                  </ThemedText>
                  {n.actionable && n.project && (
                    <View style={styles.actions}>
                      <Button
                        small
                        title="Accept"
                        onPress={() =>
                          n.kind === 'project_invite'
                            ? respondToInvite(n.project!.id, true)
                            : respondToJoinRequest(n.project!.id, n.actor!.id, true)
                        }
                      />
                      <Button
                        small
                        variant="secondary"
                        title="Decline"
                        onPress={() =>
                          n.kind === 'project_invite'
                            ? respondToInvite(n.project!.id, false)
                            : respondToJoinRequest(n.project!.id, n.actor!.id, false)
                        }
                      />
                    </View>
                  )}
                </View>
                {!n.read_at && <View style={[styles.dot, { backgroundColor: theme.accent }]} />}
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.one },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'flex-start',
  },
  body: { flex: 1, gap: Spacing.half },
  time: { fontSize: 12, lineHeight: 16 },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
});
