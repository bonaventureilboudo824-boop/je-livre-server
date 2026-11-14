'use strict';
// Règles Firebase : données publiques des livreurs (driverPublic) et verrouillage de drivers.
// Lancer :  NODE_PATH=<dossier avec targaryen@3> node test/rulesLivreurs.test.js
const targaryen = require('targaryen');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ADMIN = "root.child('adminUsers').child(auth.uid).exists()";

const phaseA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8'));
// Phase B : drivers n'est plus lisible par tout le monde.
const phaseB = JSON.parse(JSON.stringify(phaseA));
phaseB.rules.drivers['.read'] = "auth != null && (" + ADMIN + " || (query.orderByChild == 'enterpriseId' && query.equalTo == auth.uid))";
phaseB.rules.drivers.$driverId['.read'] = "auth != null && (auth.uid === $driverId || " + ADMIN + " || data.child('enterpriseId').val() === auth.uid)";
if (process.argv[2] === '--print-b') { process.stdout.write(JSON.stringify(phaseB, null, 2) + '\n'); process.exit(0); }

const data = {
  adminUsers: { admin1: true },
  drivers: {
    d1: { name: 'Issa', phone: '+22670000001', approved: true, status: 'approved', enterpriseId: 'ent1', pendingCommission: 300 },
    d2: { name: 'Awa', phone: '+22670000002', approved: false, status: 'pending' },
  },
  driverPublic: { d1: { name: 'Issa', vehicle: 'Moto', online: true, lat: 12.37, lng: -1.52 } },
};
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const db = (rules) => targaryen.database(rules, data);
const U = (uid) => ({ uid });

for (const [label, rules] of [['A', phaseA], ['B', phaseB]]) {
  const d = db(rules);
  // driverPublic : lecture par tout utilisateur connecté, pas par un anonyme
  ok(d.as(U('client9')).read('driverPublic').allowed, label + ' client lit driverPublic');
  ok(!d.as(null).read('driverPublic').allowed, label + ' anonyme ne lit pas driverPublic');
  // écriture : seulement soi-même (ou admin)
  ok(d.as(U('d1')).write('driverPublic/d1/lat', 12.4).allowed, label + ' livreur écrit sa position');
  ok(!d.as(U('client9')).write('driverPublic/d1/lat', 0).allowed, label + ' client ne modifie pas un livreur');
  ok(!d.as(U('d1')).write('driverPublic/d2/lat', 0).allowed, label + ' livreur ne modifie pas un autre');
  ok(d.as(U('admin1')).write('driverPublic/d1/online', false).allowed, label + ' admin peut');
  // validations
  ok(!d.as(U('d1')).write('driverPublic/d1/lat', 999).allowed, label + ' latitude hors limites refusée');
  ok(!d.as(U('d1')).write('driverPublic/d1/phone', '+22670000001').allowed, label + " le téléphone ne peut PAS aller dans driverPublic");
  ok(!d.as(U('d1')).write('driverPublic/d1/earningsBalance', 5).allowed, label + ' les gains non plus');
  ok(d.as(U('d1')).write('driverPublic/d1/online', true).allowed, label + ' livreur approuvé peut passer en ligne');
  ok(!d.as(U('d2')).write('driverPublic/d2/online', true).allowed, label + ' livreur non approuvé ne peut pas passer en ligne');
  ok(d.as(U('d2')).write('driverPublic/d2/online', false).allowed, label + ' hors ligne reste permis');
}
// Phase A : comportement existant conservé
ok(db(phaseA).as(U('client9')).read('drivers').allowed, 'A : drivers encore lisible (phase de transition)');
// Phase B : verrouillage
const b = db(phaseB);
ok(!b.as(U('client9')).read('drivers').allowed, 'B : un client ne lit plus drivers');
ok(!b.as(U('client9')).read('drivers/d1').allowed, 'B : un client ne lit plus la fiche d\'un livreur');
ok(!b.as(U('client9')).read('drivers/d1/phone').allowed, 'B : ni son téléphone');
ok(!b.as(U('d2')).read('drivers/d1').allowed, 'B : un livreur ne lit pas un autre livreur');
ok(b.as(U('d1')).read('drivers/d1').allowed, 'B : le livreur lit sa propre fiche');
ok(b.as(U('d1')).write('drivers/d1/lat', 12.3).allowed, 'B : le livreur écrit toujours sa fiche');
ok(b.as(U('admin1')).read('drivers').allowed, 'B : admin lit tout');
ok(b.as(U('ent1')).read('drivers/d1').allowed, 'B : l\'entreprise lit ses livreurs');
ok(!b.as(U('ent2')).read('drivers/d1').allowed, 'B : une autre entreprise non');
ok(b.as(U('ent1')).read('drivers', { query: { orderByChild: 'enterpriseId', equalTo: 'ent1' } }).allowed, 'B : l\'entreprise liste sa flotte par requête');
ok(!b.as(U('ent1')).read('drivers', { query: { orderByChild: 'enterpriseId', equalTo: 'ent2' } }).allowed, 'B : pas la flotte d\'une autre entreprise');
console.log('rulesLivreurs : ' + n + ' vérifications OK');
