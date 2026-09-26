import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Avatar } from './avatar';
import { Button } from './button';
import { Chip } from './chip';
import { Icon } from './icon';
import { IdeaCard } from './idea-card';
import { ProblemCard } from './problem-card';
import { ProjectCard } from './project-card';
import { ScrollScreen } from './scroll-screen';
import { SegmentedControl } from './segmented-control';
import { ThemedText } from './themed-text';

import { useSession } from '@/auth/session';
import { Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import {
  getProfile,
  getUserIdeas,
  getUserProblems,
  getUserProjects,
  removeVouch,
  toggleProspect,
  updateBio,
  vouchSkill,
} from '@/api';
import type { Profile, UserSkill, VouchableRole } from '@/types/models';
import { timeAgo } from '@/utils/time';

type Tab = 'problems' | 'ideas' | 'projects';

/** A user's profile: header, skills, and their problems / ideas / projects. Used by the Profile tab and /user/[id]. */
export function ProfileView({ userId, tab }: { userId: string; tab?: boolean }) {
  const { data: profile, loading } = useQuery(`profile:${userId}`, () => getProfile(userId));
  const [section, setSection] = useState<Tab>('problems');

  if (loading && !profile) return <ScrollScreen tab={tab}>{<ActivityIndicator />}</ScrollScreen>;
  if (!profile) {
    return (
      <ScrollScreen tab={tab}>
        <ThemedText themeColor="textSecondary">This user does not exist.</ThemedText>
      </ScrollScreen>
    );
  }

  return (
    <ScrollScreen tab={tab}>
      <ProfileHeader profile={profile} />
      <Skills profile={profile} />
      <View style={styles.gapTwo}>
        <SegmentedControl
          value={section}
          onChange={setSection}
          options={[
            { value: 'problems', label: `Problems ${profile.counts.problems}` },
            { value: 'ideas', label: `Ideas ${profile.counts.ideas}` },
            { value: 'projects', label: `Projects ${profile.counts.projects}` },
          ]}
        />
        {section === 'problems' && <UserProblems userId={userId} />}
        {section === 'ideas' && <UserIdeas userId={userId} />}
        {section === 'projects' && <UserProjects userId={userId} />}
      </View>
    </ScrollScreen>
  );
}

function ProfileHeader({ profile }: { profile: Profile }) {
  const theme = useTheme();
  const { user, signOut } = useSession();
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState(profile.bio);

  return (
    <View style={styles.header}>
      <Avatar user={profile} size={88} />
      <View style={styles.nameRow}>
        <ThemedText style={styles.name}>{profile.display_name}</ThemedText>
        {profile.is_entrepreneur && <Icon name="verified" size={20} color={theme.warning} />}
      </View>

      {editing ? (
        <View style={styles.editBio}>
          <TextInput
            value={bio}
            onChangeText={setBio}
            maxLength={256}
            placeholder="A short headline, e.g. BSc IT · loves UX"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            autoFocus
          />
          <View style={styles.row}>
            <Button small variant="secondary" title="Cancel" onPress={() => setEditing(false)} />
            <Button
              small
              title="Save"
              onPress={() => {
                updateBio(bio);
                setEditing(false);
              }}
            />
          </View>
        </View>
      ) : (
        !!profile.bio && (
          <ThemedText themeColor="textSecondary" style={styles.center}>
            {profile.bio}
          </ThemedText>
        )
      )}

      {profile.entrepreneur_vouches.map((v) => (
        <Pressable
          key={v.project_id}
          onPress={() => router.push({ pathname: '/project/[id]', params: { id: v.project_id } })}
          style={[styles.badge, { backgroundColor: `${theme.warning}22` }]}>
          <Icon name="star" size={14} color={theme.warning} />
          <ThemedText type="small" style={styles.flexShrink}>
            <ThemedText type="smallBold">Entrepreneur · {v.project_name}</ThemedText> — {v.description}
          </ThemedText>
        </Pressable>
      ))}

      {!editing && (
        <View style={styles.row}>
          {profile.is_self ? (
            <>
              <Button small variant="secondary" title="Edit bio" onPress={() => setEditing(true)} />
              {user && <Button small variant="secondary" title="Sign out" onPress={signOut} />}
            </>
          ) : (
            <Button
              small
              variant={profile.is_prospect ? 'secondary' : 'primary'}
              icon={profile.is_prospect ? 'personCheck' : 'personAdd'}
              title={profile.is_prospect ? 'Prospect' : 'Add as prospect'}
              onPress={() => toggleProspect(profile.id, profile.is_prospect)}
            />
          )}
        </View>
      )}
    </View>
  );
}

function Skills({ profile }: { profile: Profile }) {
  const theme = useTheme();
  const [open, setOpen] = useState<string | null>(null);
  if (profile.skills.length === 0) return null;
  const openSkill = profile.skills.find((s) => s.skill === open);

  return (
    <View style={styles.gapTwo}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.caps}>
        SKILLS · tap to see vouches
      </ThemedText>
      <View style={styles.skills}>
        {profile.skills.map((s) => {
          const active = s.skill === open;
          const highlighted = active || s.viewer_vouched;
          return (
            <Pressable
              key={s.skill}
              accessibilityRole="button"
              accessibilityState={{ expanded: active }}
              onPress={() => setOpen(active ? null : s.skill)}
              style={({ pressed }) => [
                styles.skill,
                {
                  backgroundColor: highlighted ? theme.accentSoft : theme.backgroundElement,
                  borderColor: active ? theme.accent : theme.border,
                },
                pressed && { opacity: 0.7 },
              ]}>
              <ThemedText type="small" style={highlighted && { color: theme.accent }}>
                {s.skill}
              </ThemedText>
              <View style={[styles.count, { backgroundColor: s.viewer_vouched ? theme.accent : theme.backgroundSelected }]}>
                <ThemedText type="smallBold" style={[styles.countText, { color: s.viewer_vouched ? '#fff' : theme.textSecondary }]}>
                  {s.vouch_count}
                </ThemedText>
              </View>
              <Icon name={active ? 'chevronUp' : 'chevronDown'} size={12} color={highlighted ? theme.accent : theme.textSecondary} />
            </Pressable>
          );
        })}
      </View>
      {openSkill && <VouchPanel key={openSkill.skill} profile={profile} skill={openSkill} />}
    </View>
  );
}

/** Dropdown under the skill chips: who vouched and in which project role, plus the viewer's own vouch controls. */
function VouchPanel({ profile, skill }: { profile: Profile; skill: UserSkill }) {
  const theme = useTheme();
  const [picked, setPicked] = useState<VouchableRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  const vouch = async () => {
    if (!picked) return;
    try {
      await vouchSkill(profile.id, skill.skill, picked.project_id, picked.role_id);
      setPicked(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <View style={[styles.panel, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold">
        {skill.skill} · {skill.vouch_count} vouch{skill.vouch_count === 1 ? '' : 'es'}
      </ThemedText>

      {skill.vouches.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No vouches yet.
        </ThemedText>
      ) : (
        skill.vouches.map(({ voucher, ...v }, i) => (
          <View key={voucher?.id ?? i} style={styles.vouchRow}>
            <Pressable disabled={!voucher} onPress={() => voucher && router.push({ pathname: '/user/[id]', params: { id: voucher.id } })}>
              <Avatar user={voucher} size={32} />
            </Pressable>
            <View style={styles.flex}>
              <Pressable disabled={!voucher} onPress={() => voucher && router.push({ pathname: '/user/[id]', params: { id: voucher.id } })}>
                <ThemedText type="smallBold">{voucher?.display_name ?? '[deleted]'}</ThemedText>
              </Pressable>
              {v.project && v.role ? (
                <Pressable onPress={() => router.push({ pathname: '/project/[id]', params: { id: v.project!.id } })}>
                  <ThemedText type="small" style={{ color: theme.accent }}>
                    {v.role.name} · {v.project.name}
                  </ThemedText>
                </Pressable>
              ) : (
                <ThemedText type="small" themeColor="textSecondary" style={styles.italic}>
                  Role no longer available
                </ThemedText>
              )}
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={styles.time}>
              {timeAgo(v.created_at)}
            </ThemedText>
          </View>
        ))
      )}

      {!profile.is_self && (
        <View style={[styles.panelFooter, { borderTopColor: theme.border }]}>
          {skill.viewer_vouched ? (
            <Button small variant="secondary" title="Remove my vouch" onPress={() => removeVouch(profile.id, skill.skill)} />
          ) : profile.vouchable_roles.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              You can vouch once you&apos;ve worked on a project with {profile.display_name.split(' ')[0]}.
            </ThemedText>
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                Vouch based on their role in:
              </ThemedText>
              <View style={styles.roleChips}>
                {profile.vouchable_roles.map((r) => (
                  <Chip
                    key={`${r.project_id}:${r.role_id}`}
                    label={`${r.role_name} · ${r.project_name}`}
                    selected={picked?.project_id === r.project_id && picked.role_id === r.role_id}
                    onPress={() => setPicked(r)}
                  />
                ))}
              </View>
              <View style={styles.vouchButton}>
                <Button small icon="verified" title="Vouch" disabled={!picked} onPress={vouch} />
              </View>
            </>
          )}
          {error && (
            <ThemedText type="small" style={{ color: theme.danger }}>
              {error}
            </ThemedText>
          )}
        </View>
      )}
    </View>
  );
}

function List({ loading, empty, children }: { loading: boolean; empty: boolean; children: React.ReactNode }) {
  if (loading) return <ActivityIndicator style={{ marginTop: Spacing.four }} />;
  if (empty)
    return (
      <ThemedText type="small" themeColor="textSecondary" style={[styles.center, { marginTop: Spacing.four }]}>
        Nothing here yet.
      </ThemedText>
    );
  return <View style={styles.list}>{children}</View>;
}

function UserProblems({ userId }: { userId: string }) {
  const { data } = useQuery(`user-problems:${userId}`, () => getUserProblems(userId));
  return (
    <List loading={!data} empty={data?.length === 0}>
      {data?.map((p) => <ProblemCard key={p.id} problem={p} />)}
    </List>
  );
}

function UserIdeas({ userId }: { userId: string }) {
  const { data } = useQuery(`user-ideas:${userId}`, () => getUserIdeas(userId));
  return (
    <List loading={!data} empty={data?.length === 0}>
      {data?.map((i) => <IdeaCard key={i.id} idea={i} />)}
    </List>
  );
}

function UserProjects({ userId }: { userId: string }) {
  const { data } = useQuery(`user-projects:${userId}`, () => getUserProjects(userId));
  return (
    <List loading={!data} empty={data?.length === 0}>
      {data?.map((p) => <ProjectCard key={p.id} project={p} />)}
    </List>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: Spacing.two },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  name: { fontSize: 24, lineHeight: 30, fontWeight: 800 },
  center: { textAlign: 'center' },
  row: { flexDirection: 'row', gap: Spacing.two, justifyContent: 'center', marginTop: Spacing.one },
  editBio: { alignSelf: 'stretch', gap: Spacing.two },
  input: { borderRadius: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two + 2, fontSize: 15 },
  badge: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    padding: Spacing.two + 2,
    borderRadius: Spacing.three,
    alignSelf: 'stretch',
  },
  flexShrink: { flexShrink: 1 },
  gapTwo: { gap: Spacing.three },
  caps: { fontSize: 12, letterSpacing: 0.8 },
  skills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  skill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.one + 2,
    paddingVertical: Spacing.one + 1,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  count: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  countText: { fontSize: 12, lineHeight: 16 },
  list: { gap: Spacing.three },
  panel: { borderRadius: Spacing.four - 4, padding: Spacing.three, gap: Spacing.three },
  vouchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  flex: { flex: 1 },
  italic: { fontStyle: 'italic' },
  time: { fontSize: 12 },
  panelFooter: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three, gap: Spacing.two },
  roleChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  vouchButton: { alignSelf: 'flex-start' },
});
