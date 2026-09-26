import { useLocalSearchParams } from 'expo-router';

import { ProfileView } from '@/components/profile-view';

export default function UserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProfileView userId={id} />;
}
