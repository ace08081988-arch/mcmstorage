import assert from 'node:assert/strict';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { bootstrap } from './bootstrap.mjs';

const repo = path.resolve(process.argv[2] ?? new URL('../../',import.meta.url).pathname) + '/';
const db = new PGlite({extensions:{pgcrypto}});
await db.waitReady;
await db.exec(bootstrap);
const original = p => readFileSync(repo+'supabase/migrations/'+p,'utf8');
const role = original('20260618232152_5514d915-a030-43a4-9d73-a007623c125e.sql');
await db.exec(role.slice(0,role.indexOf('-- 4. Tighten')));
await db.exec(original('20260704143105_f71943d6-a546-4a89-bffb-1bf0dcf20d1b.sql'));
await db.exec(`CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at=now(); RETURN NEW; END$$`);
const settings=original('20260623163156_dfe31319-fe85-4724-a765-dc2fd448abab.sql');
await db.exec(settings.slice(0,settings.indexOf('-- 2. SUBSCRIPTIONS TABLE')));
const historical = original('20260630054021_8f9d4373-8c4b-42aa-a185-8a3917e599cc.sql');
// Reproduce the reviewed missing-grant baseline using the unchanged column DDL.
await db.exec(historical.slice(0,historical.indexOf(';')+1));
await db.exec(`DROP POLICY "anyone can read app_settings" ON public.app_settings;
 CREATE POLICY "authenticated can read app_settings" ON public.app_settings FOR SELECT TO authenticated USING (true)`);
await db.exec(original('20260702113755_7033593e-b3ab-40c4-b031-f4fa38537b19.sql'));
const admin='11111111-1111-4111-8111-111111111111';
const ordinary='22222222-2222-4222-8222-222222222222';
await db.query(`INSERT INTO auth.users(id) VALUES ($1),($2)`,[admin,ordinary]);
await db.query(`INSERT INTO public.user_roles(user_id,role) VALUES ($1,'admin'),($2,'user')`,[admin,ordinary]);
const checks=[];
async function act(name,role,uid,sql,{deny=false,count}={}) {
 await db.exec('BEGIN');
 try {
  await db.exec(`SET LOCAL ROLE ${role}`);
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`,[uid??'']);
  let r;
  try {r=await db.query(sql);}
  catch(err){if(!deny||err.code!=='42501')throw err; checks.push({name,result:'pass',sqlstate:err.code}); return;}
  if(deny)throw new Error(`${name}: expected permission denied`);
  if(count!==undefined)assert.equal((/^\s*SELECT/i.test(sql)?r.rows.length:r.affectedRows),count,name);
  checks.push({name,result:'pass',affectedRows:r.affectedRows,rows:r.rows.length});
 }finally{await db.exec('ROLLBACK');}
}
await act('baseline admin update is denied without explicit column grant','authenticated',admin,
 `UPDATE public.app_settings SET worker_portal_config='{"enabled":true}' WHERE id=true`,{deny:true});
await db.exec(historical);
await act('historical migration grants admin config UPDATE after a fresh replay','authenticated',admin,
 `UPDATE public.app_settings SET worker_portal_config='{}' WHERE id=true`,{count:1});
await db.exec('REVOKE UPDATE(worker_portal_config) ON public.app_settings FROM authenticated');
const forward=await readFile(repo+'supabase/migrations/20261023090000_worker_portal_config_explicit_grant.sql','utf8');
await db.exec(forward);
await db.exec(forward);
checks.push({name:'forward GRANT applies twice',result:'pass'});
await act('admin updates only allowed config column','authenticated',admin,
 `UPDATE public.app_settings SET worker_portal_config='{"enabled":true}' WHERE id=true RETURNING worker_portal_config`,{count:1});
await act('ordinary authenticated user gets no settings row through RLS','authenticated',ordinary,
 `SELECT id FROM public.app_settings`,{count:0});
await act('ordinary authenticated user cannot update admin settings row','authenticated',ordinary,
 `UPDATE public.app_settings SET worker_portal_config='{"enabled":true}' WHERE id=true`,{count:0});
await act('anon update denied','anon',null,
 `UPDATE public.app_settings SET worker_portal_config='{}' WHERE id=true`,{deny:true});
await act('admin bank_name update denied','authenticated',admin,
 `UPDATE public.app_settings SET bank_name='UNAUTHORIZED' WHERE id=true`,{deny:true});
await act('admin mixed allowed and forbidden columns update denied','authenticated',admin,
 `UPDATE public.app_settings SET worker_portal_config='{}',bank_name='UNAUTHORIZED' WHERE id=true`,{deny:true});
await act('authenticated INSERT denied','authenticated',admin,
 `INSERT INTO public.app_settings(id) VALUES(true)`,{deny:true});
await act('authenticated DELETE denied','authenticated',admin,
 `DELETE FROM public.app_settings WHERE id=true`,{deny:true});
const evidence={postgres:(await db.query('SELECT version()')).rows[0].version,
 scope:'Exact app_settings + user_roles creation/final RLS/helper migrations, no defaults, minimal local Supabase fixtures; real SQL GRANT and RLS execution; no Data API server',checks};
await writeFile(path.join(repo,'docs/qa/data-api-grants-postgres-results.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({passed:checks.length,checks},null,2));
await db.close();
