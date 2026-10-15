# Accounts and profiles

Public home is `/`, with signup at `/signup`, sign-in at `/signin` and recovery at `/forgot-password`. Successful authentication starts a fresh browser navigation to `/library`. The server checks the session before choosing public home or the private library, and private routes redirect unauthenticated users to sign-in with a validated return path. Loading and connection errors never substitute the public landing page. `/profile` is a separate page with the shared workspace navigation. Logout and deletion start a fresh public-home request after ending the session.

Verification and reset have real `/account/verify` and `/account/reset` pages. Newly issued email links use those routes; older `/?verify=` and `/?reset=` links redirect compatibly. A successful submission strips the token while keeping the account route. Account pages use no-store and no-referrer headers. Signup/recovery require eight characters. Resend is enabled in production; agent keys require verified email, while library capture is available before verification. EMAIL_DISABLED remains an explicit operational fallback.

Open profile exposes name, bio, interests, image upload/removal, sign-out, and account deletion with current password plus DELETE confirmation. Resetting a password ends old sessions and revokes agent keys. Profile photos are re-encoded static PNGs; replaced/deleted data is removed from the live profile.

Drive with `tests/browser/journeys.spec.ts` and the account integration tests. Verify the visible updated profile, subsequent login, persisted records, invalid/reused links, rejected image uploads, and failed requests after logout/deletion. The recovery drill verifies deleted-account journal replay after a snapshot restore.

The signed-in profile uses a plain Profile heading and Bio label, with the existing avatar, account deletion, and sign-out controls. Shared workspace typography uses the same local fonts as the public pages.
