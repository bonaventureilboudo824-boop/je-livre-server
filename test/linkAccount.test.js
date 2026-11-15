'use strict';
// Un compte livreur / boutique / entreprise devient aussi un compte client, sans nouveau SMS.
const assert = require('assert');
const { createLinkCore } = require('../shared');

function fakeDb(init) {
  const data = JSON.parse(JSON.stringify(init));
  const get = (p) => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), data);
  const set = (p, v) => { const ks = p.split('/').filter(Boolean); let o = data; ks.slice(0, -1).forEach((k) => { o[k] = o[k] || {}; o = o[k]; }); o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v)); };
  const ref = (p) => ({
    once: async () => ({ val: () => { const v = get(p); return v === undefined ? null : JSON.parse(JSON.stringify(v)); } }),
    set: async (v) => set(p, v),
    transaction: async (fn) => { const c = get(p); const n = fn(c === undefined ? null : c); if (n === undefined) return { committed: false }; set(p, n); return { committed: true }; },
  });
  return { ref, data };
}
const mkAuth = (users) => ({
  getUser: async (uid) => { if (!users[uid]) throw new Error('nope'); return users[uid]; },
  createCustomToken: async (uid) => 'token-for-' + uid,
});
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const fails = async (p, code, m) => { try { await p; } catch (e) { assert.strictEqual(e.code, code, m + ' (code ' + e.code + ')'); n++; return; } assert.fail('devait échouer : ' + m); };

(async () => {
  const db = fakeDb({
    drivers: { d1: { name: 'Issa Ouédraogo', phone: '+22670000001' }, d2: { name: 'Sans claim', phone: '+22670000002' }, d3: { name: 'Banni', phone: '+22670000003' } },
    shops: { s1: { name: 'Boutique Wax', phone: '+22670000009', approved: true } },
    enterprises: { e1: { name: 'Rapid Express', phone: '+22670000010' } },
    users: { s1: { name: 'Déjà client', phone: '+22670000009', referralCode: 'AAAAAA' } },
    bans: { d3: { reason: 'x' } }, adminUsers: { adm: true },
  });
  const auth = mkAuth({
    d1: { customClaims: { phoneVerified: true } }, d2: { customClaims: {} }, d3: { customClaims: { phoneVerified: true } },
    s1: { customClaims: { phoneVerified: true } }, e1: { customClaims: { phoneVerified: true } }, adm: { customClaims: { phoneVerified: true } },
    x9: { customClaims: { phoneVerified: true } }, dis: { disabled: true, customClaims: { phoneVerified: true } },
  });
  let t = 0; const core = createLinkCore({ db, auth, now: () => 1700000000000, randomInt: (m) => (t++ % m) }).linkClientAccount;

  const r = await core({ uid: 'd1' });
  ok(r.ok && r.token === 'token-for-d1' && r.created && r.linkedFrom === 'driver', 'livreur lié');
  const u = db.data.users.d1;
  ok(u.name === 'Issa Ouédraogo' && u.phone === '+22670000001' && u.linkedFrom === 'driver', 'nom et téléphone recopiés');
  ok(/^[A-Z2-9]{6}$/.test(u.referralCode) && db.data.referralCodes[u.referralCode] === 'd1', 'code de parrainage créé et réservé');
  const r2 = await core({ uid: 'd1' });
  ok(r2.created === false && db.data.users.d1.referralCode === u.referralCode, 'idempotent : rien n\'est recréé');
  const r3 = await core({ uid: 's1' });
  ok(r3.created === false && db.data.users.s1.name === 'Déjà client' && r3.token === 'token-for-s1', 'un compte client existant n\'est pas écrasé');
  const r4 = await core({ uid: 'e1' });
  ok(r4.created && r4.linkedFrom === 'enterprise' && db.data.users.e1.name === 'Rapid Express', 'entreprise liée');

  await fails(core({ uid: 'd2' }), 'failed-precondition', 'numéro non vérifié refusé');
  await fails(core({ uid: 'd3' }), 'permission-denied', 'compte suspendu refusé');
  await fails(core({ uid: 'adm' }), 'permission-denied', 'administrateur refusé');
  await fails(core({ uid: 'x9' }), 'failed-precondition', 'compte sans profil professionnel refusé');
  await fails(core({ uid: 'dis' }), 'failed-precondition', 'désactivé / sans profil refusé');
  await fails(core({}), 'unauthenticated', 'non connecté refusé');
  ok(!db.data.users.d2 && !db.data.users.d3 && !db.data.users.x9, 'aucun profil client créé pour les refus');
  console.log('linkAccount : ' + n + ' vérifications OK');
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
