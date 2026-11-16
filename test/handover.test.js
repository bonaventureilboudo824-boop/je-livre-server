'use strict';
// Codes de remise : le livreur ne peut valider la récupération / la livraison qu'avec les bons codes.
const assert = require('assert');
const { createHandoverCore } = require('../shared');

function fakeDb(init) {
  const data = JSON.parse(JSON.stringify(init));
  const parts = (p) => p.split('/').filter(Boolean);
  const get = (p) => parts(p).reduce((o, k) => (o == null ? undefined : o[k]), data);
  const set = (p, v) => { const ks = parts(p); let o = data; ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }); if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v)); };
  const snap = (v) => ({ val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))) });
  const ref = (p = '') => ({
    once: async () => snap(get(p)),
    update: async (v) => { Object.entries(v).forEach(([k, x]) => set((p ? p + '/' : '') + k, x)); },
    transaction: async (fn) => { const c = get(p); const n = fn(c === undefined ? null : c); if (n === undefined) return { committed: false, snapshot: snap(c) }; set(p, n); return { committed: true, snapshot: snap(n) }; },
  });
  return { ref, data };
}
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const fails = async (p, code, m) => { try { await p; } catch (e) { assert.strictEqual(e.code, code, m + ' (code ' + e.code + ' : ' + e.message + ')'); n++; return e; } assert.fail('devait échouer : ' + m); };

(async () => {
  const db = fakeDb({
    deliveryRequests: {
      r1: { clientUid: 'c1', assignedDriverId: 'd1', status: 'assigned', handover: true, recipientCoords: { lat: 1, lng: 1 } },
      r2: { clientUid: 'c1', assignedDriverId: 'd1', status: 'assigned', handover: true },
      r3: { clientUid: 'c1', assignedDriverId: 'd1', status: 'assigned' },
    },
  });
  let seq = 0; const values = [1234, 5678, 4321, 8765, 1111, 2222];
  const core = createHandoverCore({ db, now: () => 1700000000000, randomInt: () => values[seq++ % values.length] });

  await fails(core.getHandoverCodes({ uid: null, requestId: 'r1' }), 'unauthenticated', 'connexion requise');
  await fails(core.getHandoverCodes({ uid: 'x', requestId: 'r1' }), 'permission-denied', 'pas le client');
  await fails(core.getHandoverCodes({ uid: 'c1', requestId: 'r3' }), 'failed-precondition', 'ancienne livraison sans codes');
  const codes = await core.getHandoverCodes({ uid: 'c1', requestId: 'r1' });
  ok(codes.pickup === '1234' && codes.delivery === '5678', 'codes générés');
  const again = await core.getHandoverCodes({ uid: 'c1', requestId: 'r1' });
  ok(again.pickup === '1234' && again.delivery === '5678', 'les codes ne changent pas');

  await fails(core.confirmHandover({ uid: 'd2', requestId: 'r1', step: 'pickup', code: '1234' }), 'permission-denied', "pas le livreur assigné");
  await fails(core.confirmHandover({ uid: 'd1', requestId: 'r1', step: 'delivery', code: '5678' }), 'failed-precondition', 'livraison avant récupération');
  await fails(core.confirmHandover({ uid: 'd1', requestId: 'r1', step: 'pickup', code: '12' }), 'invalid-argument', 'code invalide');
  const e1 = await fails(core.confirmHandover({ uid: 'd1', requestId: 'r1', step: 'pickup', code: '0000' }), 'permission-denied', 'mauvais code');
  ok(/4 essai/.test(e1.message), 'compte les essais restants');
  ok(!db.data.deliveryRequests.r1.pickedUpAt, 'rien validé avec un mauvais code');
  await fails(core.confirmHandover({ uid: 'd1', requestId: 'r1', step: 'pickup', code: '5678' }), 'permission-denied', 'le code de livraison ne valide pas la récupération');

  let r = await core.confirmHandover({ uid: 'd1', requestId: 'r1', step: 'pickup', code: '1234' });
  ok(r.ok && !r.completed && db.data.deliveryRequests.r1.pickedUpAt === 1700000000000, 'récupération validée');
  ok(db.data.deliveryRequests.r1.status === 'assigned', 'la livraison reste en cours');
  await fails(core.confirmHandover({ uid: 'd1', requestId: 'r1', step: 'delivery', code: '1234' }), 'permission-denied', 'le code de récupération ne valide pas la livraison');
  r = await core.confirmHandover({ uid: 'd1', requestId: 'r1', step: 'delivery', code: '5678' });
  ok(r.ok && r.completed && db.data.deliveryRequests.r1.status === 'completed' && db.data.deliveryRequests.r1.deliveredAt, 'livraison validée = terminée');
  r = await core.confirmHandover({ uid: 'd1', requestId: 'r1', step: 'delivery', code: '5678' });
  ok(r.already, 'rappel sans danger');

  // 5 mauvais essais = blocage, même avec le bon code ensuite
  await core.getHandoverCodes({ uid: 'c1', requestId: 'r2' });
  for (let i = 0; i < 5; i++) await fails(core.confirmHandover({ uid: 'd1', requestId: 'r2', step: 'pickup', code: '9999' }), 'permission-denied', 'essai ' + (i + 1));
  const good = db.data.deliveryCodes.r2.pickup;
  await fails(core.confirmHandover({ uid: 'd1', requestId: 'r2', step: 'pickup', code: good }), 'resource-exhausted', 'bloqué après 5 essais');

  // sans destinataire : la récupération termine la course
  db.data.deliveryRequests.r4 = { clientUid: 'c1', assignedDriverId: 'd1', status: 'assigned', handover: true };
  const c4 = await core.getHandoverCodes({ uid: 'c1', requestId: 'r4' });
  r = await core.confirmHandover({ uid: 'd1', requestId: 'r4', step: 'pickup', code: c4.pickup });
  ok(r.completed && db.data.deliveryRequests.r4.status === 'completed', 'collecte sans destinataire terminée à la récupération');
  console.log('handover : ' + n + ' vérifications OK');
})().catch((e) => { console.error(e); process.exit(1); });
