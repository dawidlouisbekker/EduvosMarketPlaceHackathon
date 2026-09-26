import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { SessionProvider, useSession } from '@/auth/session';
import { SignInScreen } from '@/components/sign-in-screen';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <SessionProvider>
        <AnimatedSplashOverlay />
        <App />
      </SessionProvider>
    </ThemeProvider>
  );
}

function App() {
  const { user } = useSession();

  return (
    <>
      <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="problem/[id]" options={{ title: 'Problem' }} />
        <Stack.Screen name="idea/[id]" options={{ title: 'Idea' }} />
        <Stack.Screen name="project/[id]" options={{ title: 'Project' }} />
        <Stack.Screen name="user/[id]" options={{ title: 'Profile' }} />
        <Stack.Screen name="compose/problem" options={{ presentation: 'modal', title: 'New problem' }} />
        <Stack.Screen name="compose/idea" options={{ presentation: 'modal', title: 'New idea' }} />
        <Stack.Screen name="compose/project" options={{ presentation: 'modal', title: 'New project' }} />
        <Stack.Screen name="edit/project/[id]" options={{ presentation: 'modal', title: 'Edit project' }} />
      </Stack>
      {!user && <SignInScreen />}
    </>
  );
}
