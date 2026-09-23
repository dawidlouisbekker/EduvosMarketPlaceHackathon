import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/auth/session';
import { MicrosoftSignInButton } from '@/components/microsoft-sign-in-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';

export default function HomeScreen() {
  const { user, loading, error, signIn, signOut } = useSession();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.heroSection}>
          <ThemedText type="title" style={styles.title}>
            EduvosMarket
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.title}>
            Products and services from Incubation Hub ventures, for the student community.
          </ThemedText>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.card}>
          {loading ? (
            <ActivityIndicator />
          ) : user ? (
            <>
              <ThemedText type="smallBold">Signed in as {user.display_name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {user.email}
                {user.is_admin ? ' · Hub admin' : ''}
              </ThemedText>
              {user.ventures.map((v) => (
                <ThemedText key={v.id} type="small">
                  {v.name} ({v.role}, {v.status})
                </ThemedText>
              ))}
              <Pressable onPress={signOut} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedText type="linkPrimary">Sign out</ThemedText>
              </Pressable>
            </>
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                Use your Eduvos Microsoft account. If you are already signed in to Outlook or Teams,
                you won&apos;t need to enter your password again.
              </ThemedText>
              <MicrosoftSignInButton onPress={signIn} />
            </>
          )}
          {error && (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          )}
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  heroSection: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  title: {
    textAlign: 'center',
  },
  card: {
    gap: Spacing.three,
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    borderRadius: Spacing.four,
  },
  pressed: {
    opacity: 0.7,
  },
  error: {
    color: '#D93025',
  },
});
