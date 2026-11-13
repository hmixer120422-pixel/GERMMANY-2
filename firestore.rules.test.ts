import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Security Rules Structural & Dirty Dozen Invariant Verification Suite
 * Validates firestore.rules against security_spec.md without requiring Java/Emulator dependencies.
 */
function runFirestoreRulesInvariants() {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const rules = fs.readFileSync(rulesPath, 'utf-8');

  // 1. Default-deny catch-all at root
  assert.match(
    rules,
    /match \/\{document=\*\*\}[\s\S]*allow read, write: if false;/,
    'Root default-deny catch-all rule must exist'
  );

  // 2. Email verification requirement on isSignedIn()
  assert.match(
    rules,
    /function isSignedIn\(\)[\s\S]*request\.auth != null && request\.auth\.token\.email_verified == true/,
    'isSignedIn must require email_verified == true'
  );

  // 3. Bootstrapped admin email & admins collection check
  assert.match(
    rules,
    /hmixer1204\.2\.2@gmail\.com/,
    'Bootstrapped admin email must be enforced in isAdmin()'
  );
  assert.match(
    rules,
    /exists\(\/databases\/\$\(database\)\/documents\/admins\/\$\(request\.auth\.uid\)\)/,
    'Admin role lookup must check /admins/{uid}'
  );

  // 4. Document ID validation everywhere
  assert.match(
    rules,
    /function isValidId\(id\)[\s\S]*id\.matches\('\^\[a-zA-Z0-9_\\\\-\]\+\$'\)/,
    'isValidId must enforce safe ID characters'
  );

  // 5. Dirty Dozen Check: No get() or exists() inside allow list rules
  const listRules = rules.match(/allow list:[^;]+;/g) || [];
  assert.ok(listRules.length >= 4, 'Collections must define explicit allow list rules');
  for (const rule of listRules) {
    assert.ok(
      !rule.includes('get(') && !rule.includes('exists(') && !rule.includes('isAdmin()'),
      `allow list rule must not invoke get(), exists(), or isAdmin(): ${rule}`
    );
  }

  // 6. Strict Schema Enforcement (hasAll + hasOnly) & Anti-Update-Gap
  for (const fn of [
    'isValidTtsAudioCacheEntry',
    'isValidTtsStatistics',
    'isValidTtsLibraryConfig',
    'isValidAdminUser',
    'isValidUserProfile',
  ]) {
    assert.ok(rules.includes(`function ${fn}(`), `Missing validator ${fn}`);
    const blockStart = rules.indexOf(`function ${fn}(`);
    const block = rules.slice(blockStart, blockStart + 2500);
    assert.ok(block.includes('hasAll('), `${fn} must check required keys with hasAll`);
    assert.ok(block.includes('hasOnly('), `${fn} must reject arbitrary unknown fields with hasOnly`);
  }

  // 7. Terminal state lock: non-admins cannot overwrite ready ttsAudioCache entries
  assert.match(
    rules,
    /existing\(\)\.status != 'ready'/,
    'Non-admins must be blocked from mutating ready audio cache records'
  );

  // 8. Privilege escalation prevention on /users/{userId}
  assert.match(
    rules,
    /incoming\(\)\.role == 'learner' \|\| isAdmin\(\)/,
    'User creation must block self-promotion to admin'
  );
  assert.match(
    rules,
    /incoming\(\)\.role == existing\(\)\.role/,
    'User self-update must prevent role modification'
  );

  // 9. No secret OAuth token fields allowed in Firestore rules schemas
  assert.ok(!rules.includes('refresh_token'), 'OAuth refresh_token must never be permitted in Firestore');
  assert.ok(!rules.includes('access_token'), 'OAuth access_token must never be permitted in Firestore');

  console.log('✓ All Firestore rules security invariants & Dirty Dozen checks passed.');
}

runFirestoreRulesInvariants();
