import { Platform, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

/**
 * "Sign in with Microsoft" button following Microsoft's identity branding guidelines:
 * four-square logo, fixed wording, light (#FFFFFF / #8C8C8C border) or dark (#2F2F2F) theme.
 */
export function MicrosoftSignInButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  const dark = useColorScheme() === 'dark';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Sign in with Microsoft"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        dark ? styles.dark : styles.light,
        (pressed || disabled) && styles.pressed,
      ]}>
      <View style={styles.logo}>
        <View style={[styles.square, { backgroundColor: '#F25022' }]} />
        <View style={[styles.square, { backgroundColor: '#7FBA00' }]} />
        <View style={[styles.square, { backgroundColor: '#00A4EF' }]} />
        <View style={[styles.square, { backgroundColor: '#FFB900' }]} />
      </View>
      <Text style={[styles.label, { color: dark ? '#FFFFFF' : '#5E5E5E' }]}>Sign in with Microsoft</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 41,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 0,
  },
  light: { backgroundColor: '#FFFFFF', borderColor: '#8C8C8C' },
  dark: { backgroundColor: '#2F2F2F', borderColor: '#2F2F2F' },
  pressed: { opacity: 0.7 },
  logo: { width: 21, height: 21, flexDirection: 'row', flexWrap: 'wrap', gap: 1 },
  square: { width: 10, height: 10 },
  label: { fontFamily: Platform.select({ web: "'Segoe UI', system-ui, sans-serif" }), fontSize: 15, fontWeight: '600' },
});
