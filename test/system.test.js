'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openDatabase,importFile,summary,page,detail,review}=require('../src/database');
const {analyze}=require('../src/analytics');
const {demoRows,serialize}=require('../src/demo');
const {normalize,satoshis}=require('../src/validation');
const {csvCell}=require('../src/export');
const temporary=()=>fs.mkdtempSync(path.join(os.tmpdir(),'satoshi-trace-test-'));

test('exact BTC conversion and strict evidence validation',()=>{
  assert.equal(satoshis('0.00000001'),1);assert.equal(satoshis('21000000.00000000'),2100000000000000);assert.throws(()=>satoshis('1e2'),/decimal/);
  assert.throws(()=>normalize({...demoRows(1)[0],timestamp:'2026-08-12T10:00:00'}),/timezone/);assert.throws(()=>normalize({...demoRows(1)[0],txid:'bad'}),/64 hexadecimal/);
});
for(const format of ['csv','json','xml'])test(`streams and records provenance for ${format.toUpperCase()}`,async()=>{
  const dir=temporary(),file=path.join(dir,`fixture.${format}`),db=openDatabase(':memory:');fs.writeFileSync(file,serialize(demoRows(6),format));const result=await importFile(db,file);
  assert.ok(result.accepted>=6);assert.equal(result.rejected,0);assert.match(result.sha256,/^[a-f0-9]{64}$/);const s=summary(db);assert.equal(s.transactions,6);assert.ok(s.observations>=6);assert.equal(s.imports.length,1);db.close();fs.rmSync(dir,{recursive:true,force:true});
});
test('rejects malformed rows but preserves valid evidence',async()=>{
  const dir=temporary(),file=path.join(dir,'mixed.json'),rows=demoRows(3);rows.push({...rows[0],txid:'bad'});rows.push({...rows[1],input_amounts:['0.00000001']});fs.writeFileSync(file,JSON.stringify(rows));const db=openDatabase(':memory:'),result=await importFile(db,file);assert.equal(result.rejected,2);assert.equal(summary(db).transactions,3);db.close();fs.rmSync(dir,{recursive:true,force:true});
});
test('rolls back a whole file on parser failure',async()=>{
  const dir=temporary(),file=path.join(dir,'broken.json'),db=openDatabase(':memory:');fs.writeFileSync(file,'[{"timestamp":');await assert.rejects(importFile(db,file));assert.equal(summary(db).imports.length,0);db.close();fs.rmSync(dir,{recursive:true,force:true});
});
test('correlates, trains, clusters and emits explainable leads',async()=>{
  const dir=temporary(),file=path.join(dir,'large.json'),db=openDatabase(':memory:');fs.writeFileSync(file,serialize(demoRows(180),'json'));await importFile(db,file);const run=analyze(db);assert.equal(run.modelAvailable,true);const s=summary(db);assert.equal(s.stale,false);assert.ok(s.leads>0);assert.ok(s.clusters>0);const leads=page(db,'leads',{limit:10});assert.ok(leads.total>0);assert.ok(leads.rows[0].score>=25);const d=detail(db,leads.rows[0].txid);assert.ok(JSON.parse(d.transaction.reasons).some(r=>r.points>0));assert.ok(d.sources.length>0);assert.ok(d.observations.length>0);review(db,{txid:leads.rows[0].txid,status:'In review',notes:'Corroboration pending.'});assert.equal(detail(db,leads.rows[0].txid).review.status,'In review');db.close();fs.rmSync(dir,{recursive:true,force:true});
});
test('neutralizes CSV formula cells',()=>{assert.equal(csvCell('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"');assert.equal(csvCell('-2'),'"\'-2"')});
