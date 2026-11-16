'use strict';
const assert = require('assert');
const fs = require('fs');
const targaryen = require('targaryen');
const rulesJson = JSON.parse(fs.readFileSync(__dirname + '/../database.rules.json', 'utf8'));
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const base = { adminUsers: { adm: true }, deliveryRequests: {}, marketplaceOrders: {}, tickets: {} };

const T = 'LIV-261116-K7M2QX';
let db = targaryen.database(rulesJson, base);
const w = (db, who, path, val) => db.as(who).write(path, val);
const u1 = { uid: 'u1' }, u2 = { uid: 'u2' }, adm = { uid: 'adm' };

ok(w(db, u1, '/tickets/' + T, { kind: 'delivery', id: 'dr_1', uid: 'u1', at: 1 }).allowed, 'un client réserve un ticket');
ok(!w(db, u1, '/tickets/BAD', { kind: 'delivery', id: 'dr_1', uid: 'u1' }).allowed, 'format invalide refusé');
ok(!w(db, u1, '/tickets/CMD-261116-K7M2Q0', { kind: 'order', id: 'x', uid: 'u1' }).allowed, 'caractère interdit (0) refusé');
ok(!w(db, u1, '/tickets/LIV-261116-AAAAAA', { kind: 'delivery', id: 'dr_1', uid: 'u2' }).allowed, 'uid usurpé refusé');
const db2 = targaryen.database(rulesJson, { ...base, tickets: { [T]: { kind: 'delivery', id: 'dr_1', uid: 'u1', at: 1 } } });
ok(!w(db2, u2, '/tickets/' + T, { kind: 'delivery', id: 'dr_2', uid: 'u2', at: 2 }).allowed, 'ticket déjà pris : refusé (unicité)');
ok(!w(db2, u1, '/tickets/' + T, { kind: 'delivery', id: 'dr_9', uid: 'u1', at: 2 }).allowed, 'le propriétaire ne peut pas réécrire');
ok(db2.as(adm).read('/tickets/' + T).allowed, 'admin lit un ticket');
ok(!db2.as(u1).read('/tickets/' + T).allowed, 'client ne lit pas les tickets');

const dr = { clientUid: 'u1', price: 1000, status: 'pending', ticket: T };
ok(w(db, u1, '/deliveryRequests/dr_1', dr).allowed, 'livraison avec ticket valide');
ok(w(db, u1, '/deliveryRequests/dr_2', { clientUid: 'u1', price: 1, status: 'pending' }).allowed, "ancienne app sans ticket toujours acceptée");
ok(!w(db, u1, '/deliveryRequests/dr_3', { ...dr, ticket: 'CMD-261116-K7M2QX' }).allowed, 'mauvais préfixe refusé');
const db3 = targaryen.database(rulesJson, { ...base, deliveryRequests: { dr_1: dr } });
ok(!w(db3, u1, '/deliveryRequests/dr_1/ticket', 'LIV-261116-ZZZZZZ').allowed, 'ticket immuable pour le client');
ok(w(db3, u1, '/deliveryRequests/dr_1/status', 'completed').allowed, 'le reste reste modifiable');
ok(w(db, u1, '/marketplaceOrders/CMD-AB1', { clientUid: 'u1', ticket: 'CMD-261116-K7M2QX' }).allowed, 'commande avec ticket');
ok(!w(db, u1, '/marketplaceOrders/CMD-AB2', { clientUid: 'u1', ticket: T }).allowed, 'commande avec ticket LIV refusée');
console.log('tickets : ' + n + ' vérifications OK');
