#!/usr/bin/env node
// Isolated live acceptance test. No calendar credentials or customer data are printed.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');

const PROJECT = 'rendermates-crm';
const PILOT = 'crm-sync-pilot-20261103';
const CALENDAR = 'b8bd496115a7f8f2f35909f0726505d46bc9410c26e1a4e7a47061fff1921ac3@group.calendar.google.com';
const ROOT = path.resolve(__dirname, '..');
const ENVFILE = path.join(__dirname, '.env.rendermates-crm');
const FUNCTIONS = [['calendarJobDatesChanged', 'australia-southeast2'], ['calendarReconcile', 'australia-southeast1']];
const A = { startDate: '2026-11-17', endDate: '2026-11-18' };
const B = { startDate: '2026-11-19', endDate: '2026-11-20' };
const C = { startDate: '2026-11-23', endDate: '2026-11-24' };
const D = { startDate: '2026-11-25', endDate: '2026-11-26' };

function installNoDeleteWrapper(bin) {
  const realBin = fs.realpathSync(bin);
  const lib = path.resolve(path.dirname(realBin), '..');
  assert.equal(require(path.join(lib, '..', 'package.json')).version, '15.34.2');
  const prompts = require(path.join(lib, 'deploy/functions/prompts.js'));
  // Explicitly retain ALL existing functions; never use --force.
  prompts.promptForFunctionDeletion = async () => false;
  return { realBin, prompts };
}

if (['--deploy', '--check-wrapper'].includes(process.argv[2])) {
  const { realBin, prompts } = installNoDeleteWrapper(process.env.PILOT_FIREBASE_BIN);
  if (process.argv[2] === '--check-wrapper') {
    prompts.promptForFunctionDeletion([{}]).then(value => assert.equal(value, false));
  } else {
    process.argv = [process.execPath, realBin, 'deploy', '--project', PROJECT,
      '--only', 'functions:calendar-sync', '--non-interactive'];
    require(realBin);
  }
} else if (require.main === module) {
  main().catch(() => { console.error('PILOT: interrompido; consulte o resumo de limpeza acima.'); process.exitCode = 1; });
}

function run(command, args, capture = false, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: ROOT, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', timeout: 900000
  });
  if (result.error || result.status !== 0) {
    const error = new Error('Command failed');
    error.safeStage = command === 'gcloud' ? 'consulta_ou_execucao_gcloud' : 'deploy_firebase';
    throw error;
  }
  return result.stdout || '';
}

function setting(text, key) {
  const matches = [...text.matchAll(new RegExp(`^${key}=(.*)$`, 'gm'))];
  assert.equal(matches.length, 1, 'Missing or duplicate setting');
  return matches[0][1].trim();
}
function scopedConfig(text, enabled, id) {
  return text.replace(/^CALENDAR_SYNC_ENABLED=.*$/m, `CALENDAR_SYNC_ENABLED=${enabled}`)
    .replace(/^CALENDAR_SYNC_JOB_IDS=.*$/m, `CALENDAR_SYNC_JOB_IDS=${id}`);
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}
function digest(value) { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function businessData(value) {
  const { startDate, endDate, calendarSync, ...rest } = value;
  return rest;
}
function matches(value, expected) { return value?.startDate === expected.startDate && value?.endDate === expected.endDate; }
function deploy() {
  const env = { ...process.env, PILOT_SCRIPT: __filename };
  for (const key of ['CALENDAR_SYNC_ENABLED', 'CALENDAR_SYNC_JOB_IDS', 'GOOGLE_CALENDAR_ID', 'GOOGLE_CALENDAR_WRITER']) delete env[key];
  run('npx', ['--yes', '--package=firebase-tools@15.34.2', '-c',
    'PILOT_FIREBASE_BIN="$(command -v firebase)" node "$PILOT_SCRIPT" --deploy'], false, env);
}
function verifyDeployment(enabled, id) {
  for (const [name, region] of FUNCTIONS) {
    const result = JSON.parse(run('gcloud', ['functions', 'describe', name, '--gen2',
      `--region=${region}`, `--project=${PROJECT}`,
      '--format=json(state,serviceConfig.environmentVariables.CALENDAR_SYNC_ENABLED,serviceConfig.environmentVariables.CALENDAR_SYNC_JOB_IDS)'], true));
    assert.equal(result.state, 'ACTIVE');
    assert.equal(result.serviceConfig.environmentVariables.CALENDAR_SYNC_ENABLED, String(enabled));
    assert.equal(result.serviceConfig.environmentVariables.CALENDAR_SYNC_JOB_IDS, id);
  }
}

async function main() {
  process.chdir(ROOT);
  process.env.GOOGLE_CLOUD_PROJECT = PROJECT;
  process.env.GCLOUD_PROJECT = PROJECT;
  const original = fs.readFileSync(ENVFILE, 'utf8');
  assert.equal(setting(original, 'CALENDAR_SYNC_ENABLED'), 'false');
  assert.equal(setting(original, 'CALENDAR_SYNC_JOB_IDS'), '');
  assert.equal(setting(original, 'GOOGLE_CALENDAR_ID'), CALENDAR);
  assert.equal(setting(original, 'GOOGLE_CALENDAR_WRITER'), `crm-calendar-writer@${PROJECT}.iam.gserviceaccount.com`);
  const { database } = await import('./runtime.js');
  const db = database();
  const job = db.collection('jobs').doc(PILOT);
  const state = db.collection('_calendarSyncState').doc(PILOT);
  const nonce = randomUUID();
  let deploymentAttempted = false;
  let stopped = false;
  let stage = 'preparacao';
  let failed = false;
  let realHashes;
  const interrupt = () => { stopped = true; };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  async function waitFor(range, seconds, requestScheduler = false) {
    const deadline = Date.now() + seconds * 1000;
    let nextRun = 0;
    while (Date.now() < deadline) {
      assert.equal(stopped, false, 'Interrupted');
      const [current, metadata] = await Promise.all([job.get(), state.get()]);
      if (matches(current.data(), range) && matches(metadata.data()?.base, range) &&
          metadata.data()?.status === 'synced') return current.data();
      if (requestScheduler && Date.now() >= nextRun) {
        run('gcloud', ['scheduler', 'jobs', 'run',
          'firebase-schedule-calendarReconcile-australia-southeast1',
          '--location=australia-southeast1', `--project=${PROJECT}`, '--quiet'], true);
        nextRun = Date.now() + 30000;
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    throw new Error('Timed out');
  }
  try {
    assert.equal((await job.get()).exists, false, 'Pilot ID already exists; do not overwrite');
    assert.equal((await state.get()).exists, false, 'Pilot metadata already exists; do not overwrite');
    const control = (await db.collection('_calendarSyncControl').doc('main').get()).data();
    assert.equal(control?.initialized, true);
    assert.equal(control.calendarId, CALENDAR);
    const before = await db.collection('jobs').get();
    realHashes = new Map(before.docs.map(doc => [doc.id, digest(doc.data())]));
    await job.create({
      clientName: 'CRM SYNC TEST — NO CUSTOMER', address: 'AUTOMATED TEST — NOT A REAL JOB',
      clientEmail: '', clientPhone: '', startDate: '', endDate: '', status: 'Scheduled',
      contractAmount: 1234.56, deposit: 123.45,
      claims: [{ id: 'pilot-claim', amount: 222.22, status: 'Unpaid', description: 'TEST ONLY' }],
      extras: [{ id: 'pilot-extra', amount: 33.33, description: 'TEST ONLY' }],
      pilotMarker: nonce
    });
    const fixture = businessData((await job.get()).data());
    fs.writeFileSync(ENVFILE, scopedConfig(original, true, PILOT));
    stage = 'ativacao_somente_do_piloto';
    deploymentAttempted = true;
    console.log('PILOT 1/4: publicando somente o ID fictício; funções antigas serão preservadas.');
    deploy();
    verifyDeployment(true, PILOT);
    stage = 'crm_para_google';
    console.log('PILOT 2/4: verificando criação e alteração de datas pelo backend real.');
    await job.update(A);
    await waitFor(A, 180);
    await job.update(B);
    const outgoing = await waitFor(B, 180);
    assert.equal(digest(businessData(outgoing)), digest(fixture));
    stage = 'google_para_crm';
    console.log('PILOT 3/4: aguardando alteração isolada no Google; nenhum trabalho real está habilitado.');
    const incoming = await waitFor(C, 600, true);
    assert.equal(digest(businessData(incoming)), digest(fixture));
    // This final outgoing date change acknowledges the verified incoming leg
    // to the conversation, which has Calendar access but no Firestore identity.
    await job.update(D);
    await waitFor(D, 180);
    console.log('PILOT: ida e volta confirmadas; valores, extras e contatos fictícios preservados.');
  } catch (error) {
    failed = true;
    console.error(JSON.stringify({ piloto: 'interrompido', etapa: stage,
      codigo: Number(error.status || error.code) || 'indisponivel' }));
  } finally {
    let disabled = !deploymentAttempted;
    fs.writeFileSync(ENVFILE, original);
    if (deploymentAttempted) {
      console.log('PILOT 4/4: restaurando e verificando sincronização desligada.');
      try { deploy(); verifyDeployment(false, ''); disabled = true; }
      catch { failed = true; console.error('ATENÇÃO: desligamento remoto não confirmado; preserve o registro fictício para diagnóstico.'); }
    }
    if (disabled) {
      try {
        if ((await job.get()).data()?.pilotMarker === nonce) {
          await job.delete();
          await state.delete();
          console.log('Registro e metadados fictícios removidos.');
        }
        if (realHashes) {
          const after = await db.collection('jobs').get();
          const hashes = new Map(after.docs.map(doc => [doc.id, digest(doc.data())]));
          const changed = [...realHashes].filter(([id, hash]) => hashes.get(id) !== hash).length;
          if (changed) { failed = true; console.error(`${changed} registros reais mudaram durante a janela; não atribuí nem desfiz essas mudanças.`); }
          else console.log(`${realHashes.size} registros reais permaneceram idênticos durante o teste.`);
        }
      } catch { failed = true; console.error('Não confirmei toda a limpeza do registro fictício.'); }
      console.log('Sincronização DESLIGADA; nenhum ID real foi habilitado.');
    }
    await db.terminate();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (failed) process.exitCode = 1;
  }
}
module.exports = { setting, scopedConfig, digest, businessData, matches };
