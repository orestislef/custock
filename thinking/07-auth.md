# 07. auth

Logins, tokens, invites, devices, switching between organizations, and leaving.

## who logs in, and how

My server already does logins, FCM and mail. Custock does not build a second login system.
The custock api trusts the tokens my login server issues and keeps its own `users` row with the
same subject id (see [04](04-data-model.md)).

| who | how they log in | why |
|-----|-----------------|-----|
| staff (owner, admin, manager, staff, viewer) | email + password | they use it every day, on shared wifi, sometimes on a shop tablet |
| staff, optional | google or apple | faster sign up for owners. see the apple rule below |
| customers | passwordless: 6 digit email code, or a magic link | nobody wants a password for their bakery. less friction, fewer resets |
| platform admin (me) | email + password + TOTP from day one | the keys to everything |

**decided:**

- one identity per person. the same login can be staff in two orgs and a customer of a third.
  what they see depends on memberships and customer records, not on separate accounts.
- customers can later add a password if they want, but never have to.
- phone OTP by SMS is later. it costs money per message and needs a provider.

### the apple rule

If the iOS app offers google sign in (or any third party login), App Store guideline 4.8 means we
also need an equivalent privacy focused option, and sign in with apple is the easy way to pass.
So: **either no social login at all, or google and apple together.** never google alone.

Apple "hide my email" gives us a relay address. invites sent to the real address will not match
it. the invite accept screen handles this: "you are signed in as xyz@privaterelay.appleid.com,
accept this invite with this account?" and links them anyway.

### customer codes

- 6 digits, valid 10 minutes, 5 tries, then a new code is needed.
- magic link in the same email, for people who open mail on the same phone.
- the email is in the customer's language (see [11](11-languages.md)).
- rate limited per email and per IP. the join page also has a bot check (see [06](06-customers-and-comms.md)).

## tokens

**decided:**

| token | lifetime | where it lives | notes |
|-------|----------|----------------|-------|
| access token (JWT) | 15 minutes | memory only | `sub`, `sid` (session id), issuer, expiry. nothing else |
| refresh token | 30 days, sliding | phone: secure storage (Keychain on iOS, Keystore on Android, via `expo-secure-store`). web admin: httpOnly, Secure, SameSite=Strict cookie | opaque, random, stored hashed on the server |

- **rotation:** every refresh gives a new refresh token and kills the old one.
- **reuse detection:** if an old refresh token is ever used again, someone copied it. the whole
  session family is revoked and the user has to log in again. logged in the audit log.
- **no permissions inside the JWT.** permissions change while people are logged in (a manager
  gets demoted at 11:00, the token is valid until 11:15). the token only says who you are.
  what you can do comes from `GET /v1/me/context`, which returns memberships, permissions per
  shop, rank per shop and `perms_version` (see [03](03-permissions.md)).
- the server checks permissions on every request against the database, never against the token.
- web admin: cookie based, so CSRF protection on every state changing request (same site cookie
  plus a CSRF header for the api).

## invites

How staff join an organization.

1. someone with `members.invite` picks an email, a role and a scope. the delegation rules from
   [02](02-tenancy-and-roles.md) are checked first: scope, ceiling, rank.
2. the server makes a random token, stores only its **hash**, and emails a link with the plain
   token. the email is in the **invitee's** language (the inviter picks it, default the org language).
3. the link opens the app if installed (universal link / app link), otherwise the web.
4. no account yet: sign up with that email. the email counts as verified because they clicked a
   link sent to it. existing account: log in, then accept.
5. accept creates the membership and the role assignment. the inviter gets a push.

| rule | value |
|------|-------|
| validity | 7 days |
| uses | single use. accepted or revoked, it is dead |
| resend | makes a new token, the old one dies |
| revoke | anyone who could send it, or anyone above them |
| invite to someone already in the org | adds the assignment, no new membership |
| invite to a removed member | brings them back as active, history stays |
| wrong email typed | revoke, send again. the wrong person cannot accept because the token is single use and expires |

Invites are listed under Team with status: waiting, accepted, expired, revoked.

## switching organizations

- a person with memberships in several orgs gets an **org switcher** at the top of the business side.
- the last used org is remembered per device.
- every api call carries the org in the path (`/v1/orgs/{orgId}/...`). the server checks that the
  user has an active membership there. no "current org" kept on the server.
- staff who are also customers get a switch between **work** and **my shops**. see [09](09-app-per-role.md).

## password and email

- **password reset:** link by email, valid 30 minutes, single use. after reset every other session
  is logged out.
- **passwords:** at least 10 characters, checked against a list of common and leaked passwords.
  no rules like "one symbol". hashed with argon2id (on the login server).
- **email change:** a code goes to the new address. after confirming, the old address gets a
  "your email was changed, not you? tap here" mail that can undo it for 7 days.
- customer email change works the same, and their customer records in every org follow the new
  verified email.

## deleting an account

The App Store requires that people can delete their account **inside the app**. Same for Google Play.

- profile, delete account, type a confirm word, done. no "email us to delete".
- **staff:** memberships end, their name stays in the history as "former member" (the audit log
  and the stock ledger need to say who did what). personal fields (email, phone, name) are wiped.
- **last owner block:** if they are the last owner of an org, deletion stops with a clear choice:
  transfer ownership first, or delete the organization. never silently orphan an org.
- **customers:** every customer record linked to them is erased (see [06](06-customers-and-comms.md)),
  consents are withdrawn, waiting stock alerts cancelled, devices removed.
- a 7 day grace period: the account is locked right away, actually wiped after 7 days. logging in
  during the grace period cancels the deletion.

## sessions and devices

- profile shows every logged in device: model, platform, app version, last seen, city from IP.
- log out one device, or **log out everywhere** (kills all refresh tokens of the user).
- every device row holds the FCM token. on logout the token is removed from the server first,
  then deleted on the phone, so nobody gets pushes for an account that left the phone.
- FCM tokens rotate. the app sends the new one on start and when the SDK says it changed.
- when FCM answers `UNREGISTERED` or `INVALID_ARGUMENT` for a token, the server deletes it.
- devices not seen for 90 days are cleaned up.

## protection

- rate limits: login 5 tries per 15 minutes per email, then growing wait times. OTP and reset
  requests limited per email and per IP. join page limited per IP.
- no "this email does not exist" messages on login or reset. always "if this email has an
  account, we sent a code".
- every login, failed login burst, password change, email change, 2FA change and session
  revoke goes to the audit log of the user (and of the org for membership events).
- **2FA (later):** TOTP authenticator apps, required for owners and admins once it ships, optional
  for everyone else. recovery codes shown once.
- the custom role editor and invite screens ask for the password again if the last login was more
  than 12 hours ago (a phone left unlocked in the shop should not be able to make new admins).

## shared shop tablet (later)

Many shops have one tablet by the till.

- **option:** "shop device" mode. an owner or manager logs the tablet in once and links it to a shop.
- staff switch with a 4 to 6 digit **PIN** (set in their profile, per org), not their full password.
- the PIN session only has that person's permissions in that one shop, and expires after a few
  minutes idle, back to the "who is this?" screen.
- every movement still has the real person on it. no shared "shop" user, ever.

## support access (platform admin)

- the platform admin is not a member of any org and cannot see business data by default.
- an owner turns on support access in settings, for 1 hour, 24 hours or 7 days.
- while on: the org sees a banner, everything I do is in their audit log with `actor_kind =
  platform_admin`, and the owner can turn it off at any time.
- read only by default. a write action during support needs a second confirm and is marked in the log.
