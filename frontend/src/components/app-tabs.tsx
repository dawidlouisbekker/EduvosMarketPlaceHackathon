import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { getUnreadCount } from '@/api';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';

export default function AppTabs() {
  const colors = useTheme();
  const unread = useQuery('unread-count', getUnreadCount).data ?? 0;

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.accentSoft}
      labelStyle={{ selected: { color: colors.accent } }}
      iconColor={{ selected: colors.accent }}>
      <NativeTabs.Trigger name="problems">
        <NativeTabs.Trigger.Label>Problems</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'exclamationmark.bubble', selected: 'exclamationmark.bubble.fill' }} md="report" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="ideas">
        <NativeTabs.Trigger.Label>Ideas</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'lightbulb', selected: 'lightbulb.fill' }} md="lightbulb" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="projects">
        <NativeTabs.Trigger.Label>Projects</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'hammer', selected: 'hammer.fill' }} md="rocket_launch" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="inbox">
        <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bell', selected: 'bell.fill' }} md="notifications" />
        <NativeTabs.Trigger.Badge hidden={unread === 0}>{String(unread)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="person" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
