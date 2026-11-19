'use strict';
// Le compte Firebase reçoit le claim role='authenticated' (exigé par Supabase) sans perdre ses autres claims.
const assert = require('assert');
const { createSupabaseRoleCore } = require('../shared');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const fails = async (p, code, m) => { try { await p; } catch (e) { assert.strictEqual(e.code, code, m + ' (code ' + e.code + ')'); n++; return; } assert.fail('devait échouer : ' + m); };
(async () => {
  const users = { a: { customClaims: { phoneVerified: true } }, b: { customClaims: { phoneVerified: true, role: 'authenticated' } }, c: { customClaims: undefined }, dis: { disabled: true, customClaims: {} } };
  const calls = [];
  const auth = { getUser: async (u) => { if (!users[u]) throw new Error('x'); return users[u]; }, setCustomUserClaims: async (u, c) => { calls.push([u, c]); users[u].customClaims = c; } };
  const core = createSupabaseRoleCore({ auth });
  let r = await core.ensureRole({ uid: 'a' });
  ok(r.ok && r.changed, 'claim ajouté');
  ok(calls[0][1].phoneVerified === true && calls[0][1].role === 'authenticated', 'phoneVerified conservé');
  r = await core.ensureRole({ uid: 'a' }); ok(r.ok && !r.changed && calls.length === 1, 'rien à refaire la 2e fois');
  r = await core.ensureRole({ uid: 'b' }); ok(!r.changed && calls.length === 1, 'déjà bon');
  r = await core.ensureRole({ uid: 'c' }); ok(r.changed && calls[1][1].role === 'authenticated', 'compte sans claims');
  await fails(core.ensureRole({ uid: null }), 'unauthenticated', 'sans connexion');
  await fails(core.ensureRole({ uid: 'zzz' }), 'not-found', 'compte inconnu');
  await fails(core.ensureRole({ uid: 'dis' }), 'permission-denied', 'compte désactivé');
  console.log('supabaseRole : ' + n + ' vérifications OK');
})().catch((e) => { console.error(e); process.exit(1); });
