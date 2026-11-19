'use strict';
const assert = require('assert');
const { createArchiveCore } = require('../shared');
function fakeDb(data){ return { ref: p => ({ get: async()=>({ exists:()=>{const v=p.split('/').reduce((o,k)=>o&&o[k],data);return v!=null}, val:()=>p.split('/').reduce((o,k)=>o&&o[k],data) }) }) }; }
(async()=>{
  const up=[]; const cat={ upsert: async(t,r,c)=>up.push({t,r,c}) };
  const core=createArchiveCore({ db:fakeDb({adminUsers:{A:{roles:['super_admin']}},users:{u1:{a:1},u2:{a:2}}}), catalogue:cat });
  await assert.rejects(()=>core.run('X'),/administrateurs/);
  await assert.rejects(()=>core.run(null),/Connexion/);
  const r=await core.run('A');
  assert.strictEqual(r.counts.users,2); assert.strictEqual(r.counts.drivers,0);
  assert.ok(up.find(x=>x.r[0].node==='users'&&x.c==='node,key'));
  console.log('archive.test.js OK');
})().catch(e=>{console.error(e);process.exit(1)});
(async()=>{
  const { createArchiveCore } = require('../shared'); const assert=require('assert');
  const up=[]; const cat={ upsert: async(t,r,c)=>up.push({t,r,c}) };
  const db={ref:p=>({get:async()=>({exists:()=>p==='adminUsers/A',val:()=>null})})};
  const auth={ listUsers: async(n,t)=> t? {users:[{uid:'b',email:'b@x',passwordHash:'h2',passwordSalt:'s2',metadata:{}}]} : {users:[{uid:'a',email:'a@x',passwordHash:'h',passwordSalt:'s',customClaims:{role:'authenticated'},metadata:{creationTime:'2026-01-01T00:00:00Z'},providerData:[{providerId:'password'}]}],pageToken:'p2'} };
  const r=await createArchiveCore({db,catalogue:cat,auth}).run('A');
  assert.strictEqual(r.counts.__comptesAuth,2);
  const row=up.find(x=>x.t==='fb_auth_export').r;
  assert.strictEqual(row[0].password_hash,'h'); assert.strictEqual(row[1].uid,'b');
  console.log('archive auth OK');
})().catch(e=>{console.error(e);process.exit(1)});
