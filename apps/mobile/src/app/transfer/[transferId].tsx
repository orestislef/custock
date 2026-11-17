// deep link for "items on the way". transfers have no phone screen yet, so it lands on home,
// where "on the way" is listed.
import { Redirect } from 'expo-router';

export default function TransferLink() {
  return <Redirect href="/(work)/home" />;
}
