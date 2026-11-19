#!/usr/bin/env node
'use strict';
// Transforme l'export JSON de Firebase (Realtime Database) en commandes SQL pour Supabase (catalogue).
// Usage : node scripts/firebaseToSupabase.js export.json > import.sql   (rapport sur la sortie d'erreur)
// Les lignes invalides sont écartées et listées dans le rapport ; rien n'est inventé.
const fs = require('fs');

const q = (v) => (v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'");
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? String(Math.round(v)) : d);
const real = (v) => (typeof v === 'number' && isFinite(v) ? String(v) : 'null');
const js = (o) => "'" + JSON.stringify(o == null ? {} : o).replace(/'/g, "''") + "'::jsonb";
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});

function convert(db) {
  const out = []; const skipped = []; const counts = {};
  const add = (table, sql) => { out.push(sql); counts[table] = (counts[table] || 0) + 1; };
  const skip = (table, id, why) => skipped.push(table + '/' + id + ' : ' + why);
  const nowMs = Date.now();

  out.push('begin;', 'alter table public.shops disable trigger shops_guard;', 'alter table public.reel_comments disable trigger reel_comments_count;');

  for (const [id, s] of Object.entries(obj(db.adminUsers))) if (s) add('admins', `insert into public.admins (uid) values (${q(id)}) on conflict do nothing;`);
  for (const [id, b] of Object.entries(obj(db.bans))) { const x = obj(b); add('bans', `insert into public.bans (uid, at, reason, data) values (${q(id)}, ${num(x.at, nowMs)}, ${q(x.reason || 'non précisé')}, ${js(x)}) on conflict (uid) do update set at=excluded.at, reason=excluded.reason, data=excluded.data;`); }
  for (const [id, t] of Object.entries(obj(db.termsAcceptances))) { const x = obj(t); add('terms_acceptances', `insert into public.terms_acceptances (uid, at, data) values (${q(id)}, ${num(x.at || x.acceptedAt || x.createdAt, nowMs)}, ${js(x)}) on conflict (uid) do update set data=excluded.data;`); }
  for (const [id, sh] of Object.entries(obj(db.shops))) { const x = obj(sh); add('shops', `insert into public.shops (id, approved, status, data, created_at) values (${q(id)}, ${x.approved === true}, ${q(x.status || (x.approved === true ? 'approved' : 'pending'))}, ${js(x)}, ${num(x.createdAt, nowMs)}) on conflict (id) do update set approved=excluded.approved, status=excluded.status, data=excluded.data;`); }
  for (const [id, p] of Object.entries(obj(db.products))) { const x = obj(p); if (!x.shopId) { skip('products', id, 'pas de shopId'); continue; } add('products', `insert into public.products (id, shop_id, data, created_at) values (${q(id)}, ${q(x.shopId)}, ${js(x)}, ${num(x.createdAt, nowMs)}) on conflict (id) do update set shop_id=excluded.shop_id, data=excluded.data;`); }
  for (const [id, r] of Object.entries(obj(db.reels))) {
    const x = obj(r);
    if (!x.shopId || typeof x.videoUrl !== 'string') { skip('reels', id, 'shopId ou videoUrl manquant'); continue; }
    if (x.videoUrl.length >= 500) { skip('reels', id, 'lien vidéo trop long (' + x.videoUrl.length + ')'); continue; }
    const cap = typeof x.caption === 'string' ? x.caption.slice(0, 299) : null;
    add('reels', `insert into public.reels (id, shop_id, video_url, caption, data, created_at) values (${q(id)}, ${q(x.shopId)}, ${q(x.videoUrl)}, ${q(cap)}, ${js(x)}, ${num(x.createdAt, nowMs)}) on conflict (id) do update set video_url=excluded.video_url, caption=excluded.caption, data=excluded.data;`);
  }
  // commentaires AVANT les compteurs (les compteurs exportés l'emportent)
  for (const [reelId, cs] of Object.entries(obj(db.reelComments))) for (const [cid, c] of Object.entries(obj(cs))) {
    const x = obj(c); const text = typeof x.text === 'string' ? x.text.slice(0, 300) : '';
    if (!x.uid || !text) { skip('reel_comments', reelId + '/' + cid, 'uid ou texte manquant'); continue; }
    add('reel_comments', `insert into public.reel_comments (id, reel_id, uid, name, text, created_at) values (${q(reelId + '__' + cid)}, ${q(reelId)}, ${q(x.uid)}, ${q(String(x.name || 'Utilisateur').slice(0, 60))}, ${q(text)}, ${num(x.createdAt, nowMs)}) on conflict (id) do nothing;`);
  }
  for (const [uid, ls] of Object.entries(obj(db.reelLikes))) for (const [reelId, v] of Object.entries(obj(ls))) if (v === true) add('reel_likes', `insert into public.reel_likes (uid, reel_id) values (${q(uid)}, ${q(reelId)}) on conflict do nothing;`);
  for (const [id, st] of Object.entries(obj(db.reelStats))) { const x = obj(st); add('reel_stats', `insert into public.reel_stats (reel_id, view_count, product_clicks, comment_count, like_count, watch_ms) values (${q(id)}, ${num(x.viewCount, 0)}, ${num(x.productClicks, 0)}, ${num(x.commentCount, 0)}, ${num(x.likeCount, 0)}, ${num(x.watchMs, 0)}) on conflict (reel_id) do update set view_count=excluded.view_count, product_clicks=excluded.product_clicks, comment_count=excluded.comment_count, like_count=excluded.like_count, watch_ms=excluded.watch_ms;`); }
  for (const [id, a] of Object.entries(obj(db.ads))) add('ads', `insert into public.ads (id, data) values (${q(id)}, ${js(a)}) on conflict (id) do update set data=excluded.data;`);
  for (const [id, p] of Object.entries(obj(db.places))) {
    const x = obj(p);
    if (typeof x.n !== 'string' || !x.n || x.n.length > 80 || typeof x.k !== 'string' || x.k.length > 80 || !(x.lat >= 9 && x.lat <= 15.5) || !(x.lng >= -5.7 && x.lng <= 2.5)) { skip('places', id, 'champs invalides'); continue; }
    add('places', `insert into public.places (id, n, k, lat, lng, t, s, o, fixed, at) values (${q(id)}, ${q(x.n)}, ${q(x.k)}, ${real(x.lat)}, ${real(x.lng)}, ${q(typeof x.t === 'string' ? x.t.slice(0, 40) : null)}, ${q(typeof x.s === 'string' ? x.s.slice(0, 20) : null)}, ${real(x.o)}, ${typeof x.fixed === 'boolean' ? x.fixed : 'null'}, ${num(x.at, 'null')}) on conflict (id) do update set n=excluded.n, k=excluded.k, lat=excluded.lat, lng=excluded.lng;`);
  }
  for (const [key, st] of Object.entries(obj(db.productStats))) { const x = obj(st); add('product_stats', `insert into public.product_stats (product_key, view_count, purchase_count) values (${q(key)}, ${num(x.viewCount, 0)}, ${num(x.purchaseCount, 0)}) on conflict (product_key) do update set view_count=excluded.view_count, purchase_count=excluded.purchase_count;`); }
  for (const [uid, bs] of Object.entries(obj(db.blocks))) for (const [b, v] of Object.entries(obj(bs))) { const x = obj(v); if (b === uid) { skip('blocks', uid + '/' + b, 'auto-blocage'); continue; } add('blocks', `insert into public.blocks (uid, blocked_uid, name, at) values (${q(uid)}, ${q(b)}, ${q(String(x.name || '').slice(0, 80))}, ${num(x.at, nowMs)}) on conflict do nothing;`); }

  out.push('alter table public.shops enable trigger shops_guard;', 'alter table public.reel_comments enable trigger reel_comments_count;', 'commit;');
  return { sql: out.join('\n'), counts, skipped };
}

module.exports = { convert };
if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('Usage : node scripts/firebaseToSupabase.js export.json > import.sql'); process.exit(1); }
  const { sql, counts, skipped } = convert(JSON.parse(fs.readFileSync(file, 'utf8')));
  process.stdout.write(sql + '\n');
  console.error('Lignes préparées : ' + JSON.stringify(counts));
  console.error('Lignes écartées : ' + skipped.length); skipped.forEach((s) => console.error('  - ' + s));
}
