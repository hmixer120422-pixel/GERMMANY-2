# Security Specification — Deutsch Meister Shared Cloud Audio Library

## 1. Data Invariants
1. **Catch-All Default Deny**: All unlisted collections and operations default to `false`.
2. **No OAuth Secrets in Firestore**: Google OAuth `refresh_token`, `access_token`, and `GOOGLE_CLIENT_SECRET` are NEVER stored in any Firestore document; they remain encrypted with AES-256-GCM on the Node.js server.
3. **Verified Identity**: All authenticated writes require `request.auth != null && request.auth.token.email_verified == true`.
4. **Bootstrapped Administrator**: `hmixer1204.2.2@gmail.com` (verified) or documents in `/admins/{uid}` are administrators. Learners can never self-assign `role: "admin"` in `/users/{uid}` or create `/admins/{uid}`.
5. **Distributed Lock & Terminal State Integrity (`ttsAudioCache`)**:
   - Document ID `{audioHash}` must match `^[a-zA-Z0-9_\-]+$` and equal `incoming().audioHash`.
   - Non-admin learners may only create a `generating` lock owned by `request.auth.uid` with `approvedForShared == false`. Only admins can directly write `approvedForShared == true` or overwrite/delete `ready` shared audio entries.
   - `createdAt` is immutable and must equal `request.time` on `create`. `updatedAt` must equal `request.time` on `create` and `update`.
   - Once `status == 'ready'`, non-admins cannot overwrite `driveFileId`, `driveFolderId`, `status`, or `fileSize`.
6. **PII Isolation (`users`)**: User profiles containing `email` are strictly readable and writable only by the document owner (`request.auth.uid == userId`) or `isAdmin()`. Blanket `allow list: if isSignedIn();` is prohibited.
7. **Strict Key & Size Boundaries**: Every `create` and `update` invokes `isValid[Entity](incoming())` checking `hasAll`, `hasOnly`, data types, and explicit `.size()` bounds on every string.

---

## 2. The "Dirty Dozen" Attack Payloads (Must All Yield `PERMISSION_DENIED`)

1. **Ghost Field / Shadow Update (`ttsAudioCache`)**:
   `{ "audioHash": "abc123...", ..., "isVerifiedBypass": true }` -> Rejected by `hasOnly(...)`.
2. **Unverified Admin Email Spoof (`ttsAudioCache` delete)**:
   Token with `{ email: "hmixer1204.2.2@gmail.com", email_verified: false }` -> Rejected by `email_verified == true`.
3. **ID Poisoning (`ttsAudioCache` create)**:
   Document ID `../../etc/passwd` or 1.5KB string -> Rejected by `isValidId(audioHash)`.
4. **Privilege Escalation on Signup (`users/{uid}`)**:
   Learner creates `/users/uid123` with `{ uid: "uid123", displayName: "Attacker", role: "admin", ... }` -> Rejected by `incoming().role == 'learner'`.
5. **Role Mutation on Profile Update (`users/{uid}`)**:
   Learner updates `/users/uid123` changing `role` from `"learner"` to `"admin"` -> Rejected by `affectedKeys().hasOnly(['displayName', 'preferredVoiceId', 'updatedAt'])`.
6. **Unauthorized Admin Creation (`admins/{uid}`)**:
   Non-admin creates `/admins/uid123` -> Rejected by `allow write: if isAdmin()`.
7. **PII Blanket Read / List Scraping (`users`)**:
   Signed-in learner A calls `getDoc('/users/learnerB')` or `getDocs('/users')` -> Rejected by owner/admin guard and explicit `resource.data.uid == request.auth.uid` list check.
8. **Shared Ready Audio Overwrite (`ttsAudioCache`)**:
   Non-admin learner attempts to update a `ready` document's `driveFileId` to point elsewhere -> Rejected by terminal lock (`existing().status == 'generating'`) and `isAdmin()` requirement.
9. **Spoofed Shared Approval (`ttsAudioCache`)**:
   Non-admin learner creates lock with `approvedForShared: true` -> Rejected (`incoming().approvedForShared == false`).
10. **Lock Hijacking (`ttsAudioCache`)**:
    Learner B attempts to update Learner A's active `generating` lock -> Rejected (`existing().lockOwner == request.auth.uid`).
11. **Backdated Timestamp Poisoning (`ttsAudioCache`)**:
    Client submits `createdAt` != `request.time` -> Rejected by `incoming().createdAt == request.time`.
12. **Value Poisoning / Oversized String (`ttsAudioCache`)**:
    Client submits `originalText` of 50,000 characters -> Rejected by `data.originalText.size() <= 4000`.
