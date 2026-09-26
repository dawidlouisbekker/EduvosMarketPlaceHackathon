import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from './icon';
import { MicrosoftSignInButton } from './microsoft-sign-in-button';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { useSession } from '@/auth/session';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Shown instead of the app while signed out. */
export function SignInScreen({ onDemo }: { onDemo: () => void }) {
  const theme = useTheme();
  const { loading, error, signIn } = useSession();

  return (
    <ThemedView style={StyleSheet.absoluteFill}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.hero}>
          <View style={styles.icons}>
            <Icon name="problem" size={28} color={theme.danger} />
            <Icon name="idea" size={28} color={theme.warning} />
            <Icon name="project" size={28} color={theme.success} />
          </View>
          <View>
            <ThemedText style={[styles.title, styles.center]}>Eduvos Entrepreneur</ThemedText>
            <ThemedText style={[styles.title, styles.center, { color: theme.accent }]}>Incubator</ThemedText>
          </View>
          <ThemedText themeColor="textSecondary" style={styles.center}>
            Share the problems you see in life, pitch ideas that solve them, and build projects with
            people who have the skills.
          </ThemedText>
        </View>

        <ThemedView type="backgroundElement" style={styles.card}>
          {loading ? (
            <ActivityIndicator />
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                Use your Eduvos Microsoft account. If you are already signed in to Outlook or Teams,
                you won&apos;t need to enter your password again.
              </ThemedText>
              <MicrosoftSignInButton onPress={signIn} />
              <Pressable onPress={onDemo} style={({ pressed }) => pressed && { opacity: 0.7 }}>
                <ThemedText type="linkPrimary">Explore with demo data</ThemedText>
              </Pressable>
            </>
          )}
          {error && (
            <ThemedText type="small" style={{ color: theme.danger }}>
              {error}
            </ThemedText>
          )}
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  icons: { flexDirection: 'row', gap: Spacing.three },
  title: { fontSize: 34, lineHeight: 40, fontWeight: 800 },
  center: { textAlign: 'center' },
  card: {
    gap: Spacing.three,
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    borderRadius: Spacing.four,
  },
});
