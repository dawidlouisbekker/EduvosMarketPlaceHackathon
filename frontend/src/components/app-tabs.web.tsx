import { Tabs, TabList, TabTrigger, TabSlot, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Icon, type IconName } from './icon';
import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';
import { useStoreVersion } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { getUnreadCountSync } from '@/mock/api';

const TABS: { name: string; href: '/problems' | '/ideas' | '/projects' | '/inbox' | '/profile'; label: string; icon: IconName }[] = [
  { name: 'problems', href: '/problems', label: 'Problems', icon: 'problem' },
  { name: 'ideas', href: '/ideas', label: 'Ideas', icon: 'idea' },
  { name: 'projects', href: '/projects', label: 'Projects', icon: 'project' },
  { name: 'inbox', href: '/inbox', label: 'Inbox', icon: 'inbox' },
  { name: 'profile', href: '/profile', label: 'Profile', icon: 'profile' },
];

/** Web: left sidebar on wide screens, bottom bar on phones. */
export default function AppTabs() {
  const theme = useTheme();
  const wide = useWindowDimensions().width >= 768;
  useStoreVersion();
  const unread = getUnreadCountSync();

  return (
    <Tabs style={[styles.root, { flexDirection: wide ? 'row' : 'column-reverse', backgroundColor: theme.background }]}>
      <TabList
        style={[
          wide ? styles.sidebar : styles.bottomBar,
          { borderColor: theme.border, backgroundColor: theme.background },
        ]}>
        {wide && (
          <View style={styles.brand}>
            <ThemedText style={styles.brandText}>Eduvos Entrepreneur</ThemedText>
            <ThemedText style={[styles.brandText, { color: theme.accent }]}>Incubator</ThemedText>
          </View>
        )}
        {TABS.map((t) => (
          <TabTrigger key={t.name} name={t.name} href={t.href} asChild>
            <TabButton icon={t.icon} wide={wide} badge={t.name === 'inbox' ? unread : 0}>
              {t.label}
            </TabButton>
          </TabTrigger>
        ))}
      </TabList>
      <TabSlot style={styles.slot} />
    </Tabs>
  );
}

type TabButtonProps = TabTriggerSlotProps & { icon: IconName; wide: boolean; badge: number; children: string };

function TabButton({ children, isFocused, icon, wide, badge, ...props }: TabButtonProps) {
  const theme = useTheme();
  const color = isFocused ? theme.accent : theme.textSecondary;
  return (
    <Pressable {...props} style={({ pressed }) => [wide ? styles.sideItem : styles.bottomItem, pressed && { opacity: 0.7 }]}>
      <View style={[styles.itemInner, wide && styles.sideInner, wide && isFocused && { backgroundColor: theme.accentSoft }]}>
        <View>
          <Icon name={icon} size={wide ? 22 : 24} color={color} />
          {badge > 0 && (
            <View style={[styles.badge, { backgroundColor: theme.danger }]}>
              <ThemedText style={styles.badgeText}>{badge}</ThemedText>
            </View>
          )}
        </View>
        <ThemedText type={wide ? 'default' : 'small'} style={[{ color }, !wide && styles.bottomLabel, isFocused && styles.bold]}>
          {children}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, height: '100%' },
  slot: { flex: 1 },
  sidebar: {
    width: 240,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    gap: Spacing.one,
    flexDirection: 'column',
    justifyContent: 'flex-start',
  },
  brand: { paddingHorizontal: Spacing.three, marginBottom: Spacing.four },
  brandText: { fontSize: 18, lineHeight: 24, fontWeight: 800 },
  bottomBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: Spacing.one,
    justifyContent: 'space-around',
  },
  sideItem: {},
  bottomItem: { flex: 1 },
  itemInner: { alignItems: 'center', paddingVertical: Spacing.two, gap: Spacing.half },
  sideInner: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: 999,
  },
  bottomLabel: { fontSize: 11, lineHeight: 14 },
  bold: { fontWeight: 700 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, lineHeight: 12, fontWeight: 700 },
});
