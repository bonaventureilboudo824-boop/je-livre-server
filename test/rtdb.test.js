'use strict';
const assert = require('assert');
const { createSupabaseDb, createHybridDb } = require('../shared');

// Faux PostgREST : mêmes règles que la fonction SQL jl_rec_write
function fakeCall() {
  const tables = { profiles: {}, drivers: {}, driver_public: {}, enterprises: {}, registrations: {} };
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const setPath = (d, p, v) => {
    if (!p.length) return v;
    const base = d && typeof d === 'object' && !Array.isArray(d) ? clone(d) : {};
    if (p.length === 1) { if (v === null) delete base[p[0]]; else base[p[0]] = v; return base; }
    const child = setPath(base[p[0]], p.slice(1), v);
    if (child === null || (typeof child === 'object' && !Object.keys(child).length)) delete base[p[0]]; else base[p[0]] = child;
    return base;
  };
  const get = (o, p) => { let c = o; for (const k of p) { if (c && typeof c === 'object' && k in c) c = c[k]; else return null; } return c; };
  const log = []; let hook = null;
  const codes = {};
  async function call(method, path, body) {
    log.push(method + ' ' + path);
    if (path.startsWith('referral_codes')) {
      const m = /code=eq\.(.+)$/.exec(path);
      if (method === 'GET') return codes[decodeURIComponent(m[1])] ? [{ uid: codes[decodeURIComponent(m[1])] }] : [];
      if (method === 'POST') { codes[body.code] = body.uid; return null; }
      if (method === 'DELETE') { delete codes[decodeURIComponent(m[1])]; return null; }
    }
    if (method === 'GET') {
      const [t, q] = path.split('?'); const m = /id=eq\.(.+)$/.exec(q);
      if (m) { const id = decodeURIComponent(m[1]); return tables[t][id] ? [{ data: clone(tables[t][id]) }] : []; }
      return Object.keys(tables[t]).map((id) => ({ id, data: clone(tables[t][id]) }));
    }
    if (method === 'DELETE') { const [t, q] = path.split('?'); delete tables[t][decodeURIComponent(/id=eq\.(.+)$/.exec(q)[1])]; return null; }
    if (path === 'rpc/jl_rec_write') {
      if (hook) { const h = hook; hook = null; h(tables); }
      const { p_table: t, p_id: id, p_path: p, p_value: v, p_mode: mode, p_expect: ex, p_check: chk } = body;
      assert.ok(tables[t], 'table inconnue');
      const cur = tables[t][id]; const sub = cur === undefined ? null : get(cur, p);
      if (chk && JSON.stringify(sub) !== JSON.stringify(ex === undefined ? null : ex)) return false;
      let nd = cur === undefined ? {} : clone(cur);
      if (mode === 'merge') { for (const k of Object.keys(v || {})) nd = setPath(nd, p.concat(k), v[k]); }
      else nd = setPath(nd, p, v === undefined ? null : v) || {};
      tables[t][id] = nd; return true;
    }
    throw new Error('appel inattendu ' + method + ' ' + path);
  }
  return { call, tables, log, onNextWrite: (f) => { hook = f; } };
}

(async () => {
  const f = fakeCall(); const db = createSupabaseDb({ call: f.call, now: () => 1700000000000 });
  // set / get / chemins profonds
  await db.ref('users/u1').set({ name: 'A', referralBalance: 0 });
  await db.ref('users/u1/addresses/a1').set({ label: 'Maison' });
  let s = await db.ref('users/u1').get();
  assert.deepStrictEqual(s.val(), { name: 'A', referralBalance: 0, addresses: { a1: { label: 'Maison' } } });
  assert.strictEqual((await db.ref('users/u1/referralBalance').get()).val(), 0);
  assert.strictEqual((await db.ref('users/zz').get()).exists(), false);
  assert.strictEqual((await db.ref('users/u1/nope/x').once('value')).val(), null);
  // update : champs simples, null supprime, chemins avec /
  await db.ref('users/u1').update({ name: 'B', referralCount: 3, phone: null });
  assert.ok(!('phone' in (await db.ref('users/u1').get()).val()), 'update(null) supprime le champ');
  await db.ref('users/u1').update({ 'a/b': 1 });
  assert.deepStrictEqual((await db.ref('users/u1').get()).val().a, { b: 1 });
  assert.strictEqual((await db.ref('users/u1/name').get()).val(), 'B');
  // transaction : incrément, annulation, conflit simulé puis nouvel essai
  let r = await db.ref('users/u1/referralCount').transaction((c) => (c || 0) + 2);
  assert.strictEqual(r.committed, true); assert.strictEqual(r.snapshot.val(), 5);
  r = await db.ref('users/u1/referralCount').transaction(() => undefined);
  assert.strictEqual(r.committed, false);
  f.onNextWrite((t) => { t.profiles.u1.referralCount = 100; });   // quelqu'un modifie entre la lecture et l'écriture
  r = await db.ref('users/u1/referralCount').transaction((c) => c + 1);
  assert.strictEqual(r.committed, true); assert.strictEqual((await db.ref('users/u1/referralCount').get()).val(), 101, 'le conflit doit être rejoué sans perdre la mise à jour concurrente');
  // transaction sur champ absent
  r = await db.ref('users/u1/newCounter').transaction((c) => (c || 0) + 1);
  assert.strictEqual(r.snapshot.val(), 1);
  // statut : réservation unique (comme confirmPayment)
  const claim = await db.ref('drivers/d1/status').transaction((c) => (c === 'pending' ? 'approved' : undefined));
  assert.strictEqual(claim.committed, false);
  await db.ref('drivers/d1').set({ status: 'pending', enterpriseId: 'e1' });
  assert.strictEqual((await db.ref('drivers/d1/status').transaction((c) => (c === 'pending' ? 'approved' : undefined))).committed, true);
  // push + remove
  const p = await db.ref('users/u1/searchHistory').push({ q: 'x' });
  assert.ok(p.key && p.key.length === 20);
  assert.strictEqual((await db.ref('users/u1/searchHistory/' + p.key + '/q').get()).val(), 'x');
  await db.ref('users/u1/searchHistory/' + p.key).remove();
  assert.strictEqual((await db.ref('users/u1/searchHistory').get()).exists(), false, 'les parents vides disparaissent comme dans Firebase');
  // orderByChild / equalTo / limitToLast sur tout un nœud
  await db.ref('drivers/d2').set({ status: 'pending', enterpriseId: 'e1' });
  await db.ref('drivers/d3').set({ status: 'approved', enterpriseId: 'e2' });
  const q = await db.ref('drivers').orderByChild('enterpriseId').equalTo('e1').once('value');
  assert.deepStrictEqual(Object.keys(q.val()).sort(), ['d1', 'd2']);
  const none = await db.ref('drivers').orderByChild('enterpriseId').equalTo('zzz').once('value');
  assert.strictEqual(none.exists(), false);
  let keys = []; q.forEach((c) => { keys.push(c.key); });
  assert.deepStrictEqual(keys.sort(), ['d1', 'd2']);
  // suppression d'un enregistrement entier
  await db.ref('drivers/d3').remove(); assert.strictEqual((await db.ref('drivers/d3').get()).exists(), false);
  // validations
  await assert.rejects(() => db.ref('users').set({}), /interdit/);
  assert.throws(() => db.ref('users/a b'), /chemin invalide/);
  assert.throws(() => db.ref('payments/x'), /non migré/);
  // aiguillage hybride
  const fb = { ref: (p) => ({ from: 'firebase', p }) };
  const hy = createHybridDb({ firebaseDb: fb, sbDb: db, active: true });
  assert.strictEqual(hy.ref('payments/t1').from, 'firebase');
  assert.ok(hy.ref('users/u1').child);
  const off = createHybridDb({ firebaseDb: fb, sbDb: db, active: false });
  assert.strictEqual(off.ref('users/u1').from, 'firebase', 'retour arrière RTDB_SOURCE=firebase');
  // mise à jour multi-chemins à la racine
  const fbCalls = []; const fb2 = { ref: (p) => ({ update: async (u) => { fbCalls.push(u); } }) };
  const hy2 = createHybridDb({ firebaseDb: fb2, sbDb: db, active: true });
  await db.ref('users/m1').set({ name: 'M', referralBalance: 5 });
  await hy2.ref().update({ 'payments/t9/status': 'done', 'users/m1/referralBalance': 30, 'users/m1/name': null, 'withdrawalRequests/w1': { a: 1 } });
  assert.deepStrictEqual(fbCalls, [{ 'payments/t9/status': 'done', 'withdrawalRequests/w1': { a: 1 } }]);
  const m1 = (await db.ref('users/m1').get()).val(); assert.strictEqual(m1.referralBalance, 30); assert.ok(!('name' in m1));
  await hy2.ref().update({ 'users/m1': null }); assert.strictEqual((await db.ref('users/m1').get()).exists(), false);
  // codes de parrainage
  await db.ref('referralCodes/AB12').set('u7');
  assert.strictEqual((await db.ref('referralCodes/AB12').get()).val(), 'u7');
  assert.strictEqual((await db.ref('referralCodes/ZZ').get()).exists(), false);
  const fbc = []; const hy3 = createHybridDb({ firebaseDb: { ref: () => ({ update: async (u) => fbc.push(u) }) }, sbDb: db, active: true });
  await hy3.ref().update({ 'referralCodes/AB12': null, 'payments/p': { a: 1 } });
  assert.strictEqual((await db.ref('referralCodes/AB12').get()).exists(), false); assert.deepStrictEqual(fbc, [{ 'payments/p': { a: 1 } }]);
  console.log('rtdb.test.js : tout est OK');
})().catch((e) => { console.error(e); process.exit(1); });
