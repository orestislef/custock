// prints a new VAPID key pair for web push. put them in deploy/.env, keep the private key secret.
// changing the pair later means every browser has to subscribe again.

import { newVapidKeys } from '../src/lib/webpush';

const k = newVapidKeys();
console.log(`CUSTOCK_VAPID_PUBLIC_KEY=${k.publicKey}`);
console.log(`CUSTOCK_VAPID_PRIVATE_KEY=${k.privateKey}`);
console.log('CUSTOCK_VAPID_SUBJECT=mailto:you@example.com');
