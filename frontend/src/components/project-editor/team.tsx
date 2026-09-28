import { View } from 'react-native';

import { Avatar } from '../avatar';
import { Button } from '../button';
import { Chip } from '../chip';
import { Section } from '../section';
import { ThemedText } from '../themed-text';
import { editorStyles, ErrorText, Hint, toggled, useAction } from './shared';

import { cancelInvite, getMyProspects, inviteToProject, removeParticipant, setParticipantRoles } from '@/api';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import type { ProjectDetail, UserSummary } from '@/types/models';

/** Who holds which role, removing people, and inviting prospects. */
export function TeamSection({ project }: { project: ProjectDetail }) {
  const theme = useTheme();
  const { run, error } = useAction();
  const { data: prospects } = useQuery('my-prospects', getMyProspects);

  const onTeam = new Set(project.team.map((m) => m.user?.id));
  const invited = new Set(project.invites.map((u) => u.id));
  const invitable = (prospects ?? []).filter((u) => !onTeam.has(u.id) && !invited.has(u.id));

  return (
    <Section title={`Team · ${project.team.length}`}>
      {project.team.map(({ user, role_ids }, i) => {
        if (!user) return null;
        const isOwner = i === 0;
        return (
          <View key={user.id} style={[editorStyles.card, { backgroundColor: theme.backgroundElement }]}>
            <Person user={user}>
              {isOwner ? (
                <Chip label="Owner" color={theme.warning} />
              ) : (
                <Button small variant="danger" title="Remove" onPress={() => run(() => removeParticipant(project.id, user.id))} />
              )}
            </Person>
            {project.roles.length === 0 ? (
              <Hint>Add roles above to assign them.</Hint>
            ) : (
              <View style={editorStyles.chips}>
                {project.roles.map((r) => (
                  <Chip
                    key={r.id}
                    label={r.name}
                    selected={role_ids.includes(r.id)}
                    onPress={() => run(() => setParticipantRoles(project.id, user.id, toggled(role_ids, r.id)))}
                  />
                ))}
              </View>
            )}
          </View>
        );
      })}

      {project.invites.length > 0 && <ThemedText type="smallBold">Invited</ThemedText>}
      {project.invites.map((u) => (
        <Person key={u.id} user={u}>
          <Button small variant="secondary" title="Cancel invite" onPress={() => run(() => cancelInvite(project.id, u.id))} />
        </Person>
      ))}

      <ThemedText type="smallBold">Invite your prospects</ThemedText>
      {!prospects ? null : invitable.length === 0 ? (
        <Hint>
          {prospects.length === 0
            ? 'You have no prospects yet. Add people as prospects from their profile to invite them.'
            : 'All your prospects are on the team or invited.'}
        </Hint>
      ) : (
        invitable.map((u) => (
          <Person key={u.id} user={u}>
            <Button small icon="personAdd" title="Invite" onPress={() => run(() => inviteToProject(project.id, u.id))} />
          </Person>
        ))
      )}
      <ErrorText error={error} />
    </Section>
  );
}

function Person({ user, children }: { user: UserSummary; children: React.ReactNode }) {
  return (
    <View style={editorStyles.row}>
      <Avatar user={user} size={32} />
      <ThemedText type="smallBold" numberOfLines={1} style={editorStyles.flex}>
        {user.display_name}
      </ThemedText>
      {children}
    </View>
  );
}
