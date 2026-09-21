import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import { exportProgress, captureIdentity } from './migration.js';
import { previewActivation, activateImport, activationRecovery, defaultSelection } from './migrationActivation.js';
import { createMatchStore } from './matchStore.js';
const session={v:1,username:'Synthetic',usernameId:'1'.repeat(64),authToken:'2'.repeat(64),aesKey:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',profileId:'3'.repeat(64)};
let bundle, selected, activated;
beforeEach(async()=>{
 localStorage.clear();Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});globalThis.TextEncoder=TextEncoder;globalThis.TextDecoder=TextDecoder;
 Object.defineProperty(navigator,'locks',{value:{request:async(_key,fn)=>fn()},configurable:true});AbortSignal.timeout=()=>new AbortController().signal;
 localStorage.setItem('gipfAccount',JSON.stringify(session));localStorage.setItem('chessDarkMode','true');
 bundle=(await exportProgress('https://synthetic.example.test')).bundles[0];selected=defaultSelection(bundle);localStorage.setItem('chessDarkMode','false');activated=false;
 globalThis.fetch=jest.fn(async(_url,options)=>{
   const body=JSON.parse(options.body);
   if(body.action==='migration-preview')return {ok:true,json:async()=>activated?{status:'replay'}:{status:'preview',token:'synthetic',conflicts:['chessDarkMode']}};
   activated=true;return {ok:true,json:async()=>({status:'activated'})};
 });
});
afterEach(()=>jest.restoreAllMocks());
test('explicit activation preserves encrypted before/after, freezes mounted writers and replay does not reset later edits',async()=>{
 const store=createMatchStore('yinsh');const plan=await previewActivation(bundle,selected);
 expect(localStorage.getItem('chessDarkMode')).toBe('false');
 expect((await activateImport(plan)).status).toBe('activated');expect(localStorage.getItem('chessDarkMode')).toBe('true');
 expect(()=>store.assertOwner()).toThrow('account_changed');
 const recovered=await activationRecovery();expect(recovered.before.chessDarkMode).toBe('false');expect(recovered.done).toBe(true);
 expect(localStorage.getItem(`gamesMigrationActivation:v1:${session.usernameId}`)).not.toContain('chessDarkMode');
 localStorage.setItem('chessDarkMode','false');const count=fetch.mock.calls.length;
 expect((await activateImport(plan)).status).toBe('replay');expect(fetch.mock.calls.length).toBe(count);expect(localStorage.getItem('chessDarkMode')).toBe('false');
});
test('quota before journal prevents cloud write and retains original active data',async()=>{
 const plan=await previewActivation(bundle,selected);const set=Storage.prototype.setItem;
 jest.spyOn(Storage.prototype,'setItem').mockImplementation(function(k,v){if(k.startsWith('gamesMigrationActivation:'))throw new Error('quota');return set.call(this,k,v);});
 await expect(activateImport(plan)).rejects.toThrow('quota');expect(activated).toBe(false);expect(localStorage.getItem('chessDarkMode')).toBe('false');
});
test('lost HTTP response leaves pending journal and resumes idempotently after reload',async()=>{
 const plan=await previewActivation(bundle,selected);fetch.mockImplementationOnce(async()=>{activated=true;throw new Error('lost_response');});
 await expect(activateImport(plan)).rejects.toThrow('lost_response');expect(localStorage.getItem('chessDarkMode')).toBe('false');
 const journal=await activationRecovery();expect(journal.done).toBe(false);
 fetch.mockResolvedValue({ok:true,json:async()=>({status:'replay'})});
 await activateImport({bundle:journal.bundle,selected:journal.selected,before:journal.before,cloud:{token:journal.token}});
 expect(localStorage.getItem('chessDarkMode')).toBe('true');expect((await activationRecovery()).done).toBe(true);
});
test('post-await account change never promotes data into another account',async()=>{
 const plan=await previewActivation(bundle,selected);
 fetch.mockImplementationOnce(async()=>{localStorage.setItem('gipfAccount',JSON.stringify({...session,usernameId:'4'.repeat(64)}));return {ok:true,json:async()=>({status:'activated'})};});
 await expect(activateImport(plan)).rejects.toThrow('account_changed');expect(localStorage.getItem('chessDarkMode')).toBe('false');expect(await activationRecovery()).toBeNull();
});
test('same-account transition between request and response permanently fences capture even after marker clears',async()=>{
 const guard=captureIdentity();fetch.mockImplementationOnce(async()=>{
   localStorage.setItem('gipf:account-epoch','finished-transition');
   return {ok:true,json:async()=>({status:'preview',token:'synthetic'})};
 });
 await expect(previewActivation(bundle,selected,guard)).rejects.toThrow('account_changed');expect(localStorage.getItem('chessDarkMode')).toBe('false');
});
test('new progress during cloud await is never overwritten and keeps pending recovery',async()=>{
 const plan=await previewActivation(bundle,selected);
 fetch.mockImplementationOnce(async()=>{localStorage.setItem('chessLearningGoal','new edit');return {ok:true,json:async()=>({status:'activated'})};});
 await expect(activateImport(plan)).rejects.toThrow('progress_changed');expect(localStorage.getItem('chessLearningGoal')).toBe('new edit');expect(localStorage.getItem('chessDarkMode')).toBe('false');expect((await activationRecovery()).done).toBe(false);
});
test('partial local quota failure resumes only old/imported values and preserves the backup',async()=>{
 const plan=await previewActivation(bundle,selected);const set=Storage.prototype.setItem;let journalWrites=0;
 const spy=jest.spyOn(Storage.prototype,'setItem').mockImplementation(function(k,v){if(k.startsWith('gamesMigrationActivation:')&&++journalWrites===2)throw new Error('quota');return set.call(this,k,v);});
 await expect(activateImport(plan)).rejects.toThrow('quota');spy.mockRestore();
 expect(localStorage.getItem('chessDarkMode')).toBe('true');expect((await activationRecovery()).done).toBe(false);
 fetch.mockResolvedValue({ok:true,json:async()=>({status:'replay'})});await activateImport(plan);expect((await activationRecovery()).done).toBe(true);
});
test('guest cannot preview or activate and never calls account endpoint',async()=>{
 localStorage.removeItem('gipfAccount');await expect(previewActivation(bundle,selected)).rejects.toThrow('account_required');await expect(activateImport({bundle,selected})).rejects.toThrow('account_required');expect(fetch).not.toHaveBeenCalled();
});

test('a fresh conflict preview can retry an uncommitted journal without a permanent stale token',async()=>{
 const first=await previewActivation(bundle,selected);
 fetch.mockResolvedValueOnce({ok:false,json:async()=>({error:'migration_conflict'})});
 await expect(activateImport(first)).rejects.toThrow('migration_conflict');
 fetch.mockResolvedValueOnce({ok:true,json:async()=>({status:'preview',token:'fresh-token',conflicts:[]})});
 const next=await previewActivation(bundle,selected);await activateImport(next);
 expect(localStorage.getItem('chessDarkMode')).toBe('true');
 expect(JSON.parse(fetch.mock.calls.at(-1)[1].body).token).toBe('fresh-token');
});

test('account changing while activation waits for the writer lock cannot claim or promote for the new account',async()=>{
 const plan=await previewActivation(bundle,selected);
 navigator.locks.request=async(name,fn)=>{
   if(name==='gipf-account-writer-v1')localStorage.setItem('gipfAccount',JSON.stringify({...session,usernameId:'4'.repeat(64)}));
   return fn();
 };
 await expect(activateImport(plan)).rejects.toThrow('account_changed');expect(activated).toBe(false);expect(localStorage.getItem('chessDarkMode')).toBe('false');
});
