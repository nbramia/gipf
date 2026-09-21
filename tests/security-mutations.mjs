// Run only with a separate disposable GIPF_TEST_REDIS_CONTAINER. Mutate a temporary
// source copy, never the checkout or a running browser fixture's modules.
import assert from 'node:assert/strict';
import { mkdtemp, cp, symlink, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root=await mkdtemp(join(tmpdir(),'gipf-security-mutations-'));
try {
  for(const path of ['api','server','tests','package.json']) await cp(resolve(path),join(root,path),{recursive:true});
  await symlink(resolve('src'),join(root,'src'));
  const mutations=[
    ['M1 public username pre-auth lockout','api/chessAccount.js',s=>{
      const line="    if (!await limit('account-user', u, 20)) return res.status(429).json({ error: 'rate_limited' });";
      return s.replace(line,'').replace("    if (action === 'create')",line+"\n    if (action === 'create')");
    },'bad-auth floods','tests/account-redis.test.mjs'],
    ['M2 no-source lifetime consumption','api/chessProfile.js',s=>s.replace("if ARGV[11]=='0' then return 2 end;",''),'concurrent empty claims','tests/account-redis.test.mjs'],
    ['M2 repeat daily consumption','api/chessProfile.js',s=>s.replace('      const id = body.legacyId;',"      if (!await limit('claim-user', body.u, 5, 86400)) return res.status(429).json({error:'rate_limited'});\n      const id = body.legacyId;"),'concurrent empty claims','tests/account-redis.test.mjs'],
    ['Yinsh missing durable guard','api/aiMove.js',s=>s.replace("  if (!await guardRequest(req, res, { bucket: 'ai', limit: 30, maxBytes: 32768 })) return;",''),'Yinsh checks shared','tests/ai-security.test.mjs'],
    ['Yinsh weakened hard deadline','server/yinshCalculation.js',s=>s.replace('finish(true), 3000','finish(true), 6000'),'Yinsh hard deadline','tests/ai-security.test.mjs'],
  ];
  for(const [label,path,mutate,pattern,suite] of mutations) {
    const target=join(root,path),original=await readFile(target,'utf8'),changed=mutate(original);
    assert.notEqual(changed,original,`${label}: mutation did not apply`);
    await writeFile(target,changed);
    const result=spawnSync(process.execPath,['--test','--test-name-pattern',pattern,suite],{cwd:root,encoding:'utf8',timeout:30000});
    await writeFile(target,original);
    assert.equal(result.error,undefined,`${label}: probe did not complete`);
    assert.notEqual(result.status,0,`${label}: test survived mutation`);
    assert.match(result.stdout,/not ok/,`${label}: no failing test evidence`);
    console.log(`KILLED: ${label}`);
  }
} finally { await rm(root,{recursive:true,force:true}); }
