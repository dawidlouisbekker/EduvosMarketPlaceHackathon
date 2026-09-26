import { ProfileView } from '@/components/profile-view';
import { MY_ID } from '@/mock/api';

export default function MyProfileScreen() {
  return <ProfileView userId={MY_ID} tab />;
}
