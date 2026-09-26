import { useSession } from '@/auth/session';
import { ProfileView } from '@/components/profile-view';

export default function MyProfileScreen() {
  const { user } = useSession();
  return user ? <ProfileView userId={user.id} tab /> : null;
}
