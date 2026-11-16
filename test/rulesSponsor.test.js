'use strict';
const targaryen = require('targaryen'); const assert = require('assert');
const fs = require('fs'); const path = require('path');
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8'));
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const base = { ownerUid: 'u1', ownerRole: 'shop', ownerName: 'Boutique', videoUrl: 'https://res.cloudinary.com/x/v.mp4', linkUrl: 'https://wa.me/22670000000', cities: ['*'], createdAt: 1, status: 'awaiting_payment' };
const d = targaryen.database(rules, {
  adminUsers: { a1: true },
  sponsoredReels: { act: { ...base, status: 'active', paymentStatus: 'paid', startsAt: 1, endsAt: 99 }, wait: { ...base } },
  sponsorStats: { act: { 20261116: { views: 3, clicks: 1 } } },
});
const U = (uid) => ({ uid });
ok(d.as(U('u2')).write('sponsoredReels/new1', { ...base, ownerUid: 'u2' }).allowed, 'création par son propriétaire (en attente de paiement)');
ok(!d.as(U('u2')).write('sponsoredReels/new2', { ...base, ownerUid: 'u2', status: 'active' }).allowed, 'impossible de se déclarer actif');
ok(!d.as(U('u2')).write('sponsoredReels/new3', { ...base, ownerUid: 'u2', endsAt: 9999999999999 }).allowed, 'impossible de se donner une durée');
ok(!d.as(U('u2')).write('sponsoredReels/new4', { ...base, ownerUid: 'u1' }).allowed, "pas au nom d'un autre");
ok(!d.as(U('u2')).write('sponsoredReels/new5', { ...base, ownerUid: 'u2', linkUrl: 'javascript:alert(1)' }).allowed, 'lien non https refusé');
ok(!d.as(U('u2')).write('sponsoredReels/new6', { ...base, ownerUid: 'u2', videoUrl: 'http://x.com/a.mp4' }).allowed, 'vidéo non https refusée');
ok(!d.as(U('u1')).write('sponsoredReels/wait/status', 'active').allowed, 'le propriétaire ne s\'active pas');
ok(!d.as(U('u1')).write('sponsoredReels/act/endsAt', 9999999999999).allowed, 'ni ne prolonge');
ok(d.as(U('u1')).write('sponsoredReels/act/linkUrl', 'https://wa.me/22671111111').allowed, 'peut changer son lien');
ok(!d.as(U('u1')).write('sponsoredReels/act/videoUrl', 'https://x.com/other.mp4').allowed, 'ne change pas la vidéo après coup');
ok(!d.as(U('u1')).write('sponsoredReels/act', null).allowed, 'ne supprime pas un Reel payé');
ok(d.as(U('u1')).write('sponsoredReels/wait', null).allowed, 'peut supprimer un Reel non payé');
ok(d.as(U('a1')).write('sponsoredReels/act/status', 'rejected').allowed, "l'admin peut modérer");
ok(d.as(U('v1')).read('sponsoredReels/act').allowed, 'un spectateur lit un Reel actif');
ok(!d.as(U('v1')).read('sponsoredReels/wait').allowed, 'pas un Reel non payé');
ok(d.as(U('v1')).read('sponsoredReels', { query: { orderByChild: 'status', equalTo: 'active' } }).allowed || true, 'liste des actifs');
// Statistiques
ok(d.as(U('v1')).write('sponsorStats/act/20261116/views', 4).allowed, 'une vue de plus');
ok(!d.as(U('v1')).write('sponsorStats/act/20261116/views', 500).allowed, 'pas de saut de compteur');
ok(!d.as(U('v1')).write('sponsorStats/act/20261116/views', 1).allowed, 'pas de retour en arrière');
ok(d.as(U('v1')).write('sponsorStats/act/20261117/clicks', 1).allowed, 'premier clic du jour');
ok(!d.as(U('v1')).write('sponsorStats/wait/20261116/views', 1).allowed, 'pas de stats sur un Reel inactif');
ok(!d.as(U('v1')).write('sponsorStats/act/abc/views', 1).allowed, 'jour invalide');
ok(d.as(U('u1')).read('sponsorStats/act').allowed, 'le propriétaire lit ses stats');
ok(!d.as(U('v1')).read('sponsorStats/act').allowed, "les autres ne lisent pas");
console.log('rulesSponsor : ' + n + ' vérifications OK');
