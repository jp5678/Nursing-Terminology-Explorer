#!/usr/bin/env node
/* =====================================================================
   간호 표준용어 탐색기 — 용어 데이터 공식 원본 대조 스크립트

   index.html 의 TERMINOLOGY_DATA 를 각 표준의 공식 원본과 대조해
   불일치 항목을 보고합니다. 파일은 수정하지 않습니다(읽기 전용).

   사용법 (Node.js 18 이상, 추가 패키지 불필요)
     node tools/verify_terminology.mjs
     node tools/verify_terminology.mjs --only kcd,icd10
     node tools/verify_terminology.mjs --icd11-release 2026-01
     node tools/verify_terminology.mjs --icd11-file ./SimpleTabulation-ICD-11-MMS-en.txt
     node tools/verify_terminology.mjs --snowstorm https://<Snowstorm 서버>/snowstorm/snomed-ct
     node tools/verify_terminology.mjs --json report.json

   대조 원본
     kcd    KOICD KCD-9            https://www.koicd.kr/kcd/kcd9.do
     icd10  WHO ICD-10 2019판      https://icd.who.int/browse10/2019/en
     icd11  WHO ICD-11 MMS 릴리스 표(SimpleTabulation, ICD-11 Browser 의 Info 메뉴에서 제공)
     snomed SNOMED CT International (Snowstorm 서버, --snowstorm 로 주소 지정 시에만 실행)
     icnp   SNOMED CT의 ICNP 매핑 참조집합(진단 711112009 · 중재 712505008) (위와 같은 Snowstorm 서버 필요)

   주의
     - 사이트 구조가 바뀌면 대조가 실패할 수 있습니다. 그 경우 "조회 실패"로 보고하며
       데이터가 틀렸다는 뜻이 아닙니다. 사이트에서 직접 확인하세요.
     - SNOMED CT 공개 서버(snowstorm.ihtsdotools.org)와 브라우저는 자동화 접속을 차단합니다.
       기관이 운영하는 Snowstorm 서버 주소가 있을 때만 --snowstorm 을 쓰세요.
       이 경로(snomed, icnp)는 실서버로 시험하지 못한 상태로 작성되었습니다.
     - ICD-11 은 릴리스 표를 내려받아 압축을 풉니다(unzip 명령 필요).
       unzip 이 없으면 표를 직접 풀어 --icd11-file 로 지정하세요.
     - 프록시를 거쳐야 하는 환경(사내망 등)에서는 NODE_USE_ENV_PROXY=1 을 앞에 붙여 실행하세요.
     - 요청 사이에 지연을 두어 서버에 부담을 주지 않도록 했습니다. 지연을 줄이지 마세요.
   ===================================================================== */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const FILE = path.resolve(opt('file', path.join(ROOT, 'index.html')));
const ONLY = (opt('only', 'kcd,icd10,icd11,snomed,icnp')).split(',').map(s => s.trim());
const ICD11_RELEASE = opt('icd11-release', '2026-01');
const ICD11_FILE = opt('icd11-file', '');
const SNOWSTORM = (opt('snowstorm', process.env.SNOWSTORM_URL || '')).replace(/\/$/, '');
const SNOMED_BRANCH = opt('snomed-branch', 'MAIN');
const ICNP_BRANCH = opt('icnp-branch', 'MAIN');
const JSON_OUT = opt('json', '');
const ICNP_REFSETS = ['711112009', '712505008'];   // ICNP 진단·중재 → SNOMED CT simple map
const UA = 'nursing-terminology-explorer-verify/1.0 (educational data check)';
const DELAY_MS = 500;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = s => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const squash = s => String(s ?? '').replace(/[–—-]/g, '-').replace(/\s+/g, '');

async function http(url, init = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers || {}) }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) { last = e; await sleep(1500 * (i + 1)); }
  }
  throw last;
}

function loadData() {
  const html = fs.readFileSync(FILE, 'utf8');
  const head = 'const TERMINOLOGY_DATA = [';
  const a = html.indexOf(head), b = html.indexOf('\n];', a);
  if (a < 0 || b < 0) throw new Error('TERMINOLOGY_DATA 블록을 찾지 못했습니다: ' + FILE);
  return JSON.parse('[' + html.slice(a + head.length, b) + ']');
}

const results = [];   // { std, id, code, status: 'ok'|'diff'|'error'|'skip', detail }
const add = (std, c, code, status, detail = '') => results.push({ std, id: c ? c.id : '', concept: c ? c.concept_ko : '', code, status, detail });

/* ---------------- KCD-9 ---------------- */
async function kcdPost(pathname, params) {
  const res = await http('https://www.koicd.kr' + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://www.koicd.kr/kcd/kcd9.do' },
    body: new URLSearchParams(params)
  });
  const j = await res.json();
  if (j.result !== 'S') throw new Error('KOICD 응답 result=' + j.result);
  return j.json || [];
}
async function verifyKcd(data) {
  let chapters;
  try { chapters = await kcdPost('/kcd/clsKcdTree.json', { clsOrder: '1', krLrVer: '09', parentWhere: '' }); }
  catch (e) { add('kcd', null, '', 'error', 'KOICD 접속 실패: ' + (e.cause?.code || e.message)); return; }
  const blocksByRoot = {};
  for (const c of data.filter(c => c.kcd9.code)) {
    const code = c.kcd9.code;
    try {
      await sleep(DELAY_MS);
      const rows = (await kcdPost('/kcd/clsKcdContent.json', { clsGrpCd: '01', krLrVer: '09', query: code, searchType: 'V' })).map(r => r._source);
      const hit = rows.find(s => strip(s.CLS_CD).toUpperCase() === code.toUpperCase());
      if (!hit) { add('kcd', c, code, 'diff', 'KCD-9에서 코드를 찾지 못함'); continue; }
      const diffs = [];
      if (hit.TITLE_KR !== c.kcd9.name) diffs.push(`명칭: 앱 “${c.kcd9.name}” / 원본 “${hit.TITLE_KR}”`);
      const ch = chapters.find(x => String(x.CID) === String(hit.ROOT_CID));
      const chNorm = s => squash(String(s).replace(/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX]+\.?\s*/, '').replace(/\([A-Z]\d\d-[A-Z]\d\d\)\s*$/, ''));
      if (!ch || chNorm(ch.TITLE_KR) !== chNorm(c.kcd9.chapter)) diffs.push(`장: 앱 “${c.kcd9.chapter}” / 원본 “${ch ? ch.TITLE_KR : '?'}”`);
      const root = String(hit.ROOT_CID);
      if (!blocksByRoot[root]) { await sleep(DELAY_MS); blocksByRoot[root] = await kcdPost('/kcd/clsKcdTree.json', { clsOrder: '2', krLrVer: '09', parentWhere: root }); }
      const bl = blocksByRoot[root].find(x => String(x.CID) === String(hit.LEVEL_TITLE).split('.')[1]);
      const m = bl && bl.TITLE_KR.match(/^(.*)\(([A-Z]\d\d)-([A-Z]\d\d)\)\s*$/);
      const official = m ? `${m[2]}–${m[3]} ${m[1].trim()}` : (bl ? bl.TITLE_KR : '?');
      if (official !== c.kcd9.block) diffs.push(`블록: 앱 “${c.kcd9.block}” / 원본 “${official}”`);
      add('kcd', c, code, diffs.length ? 'diff' : 'ok', diffs.join(' | '));
    } catch (e) { add('kcd', c, code, 'error', '조회 실패: ' + e.message); }
  }
}

/* ---------------- ICD-10 (WHO 2019) ---------------- */
async function verifyIcd10(data) {
  for (const c of data.filter(c => c.icd10.code)) {
    const code = c.icd10.code;
    try {
      await sleep(DELAY_MS);
      const html = await (await http('https://icd.who.int/browse10/2019/en/GetConcept?ConceptId=' + encodeURIComponent(code))).text();
      const m = html.match(new RegExp(`id="${code.replace(/\./g, '\\.')}" class="code">[^<]*</a>\\s*<span class="label">([\\s\\S]*?)</span>`));
      if (!m) { add('icd10', c, code, 'diff', 'ICD-10 2019판에서 코드를 찾지 못함'); continue; }
      const title = strip(m[1]);
      add('icd10', c, code, title === c.icd10.name ? 'ok' : 'diff', title === c.icd10.name ? '' : `명칭: 앱 “${c.icd10.name}” / 원본 “${title}”`);
    } catch (e) { add('icd10', c, code, 'error', '조회 실패: ' + e.message); }
  }
}

/* ---------------- ICD-11 (WHO MMS 릴리스 표) ---------------- */
async function loadIcd11Table() {
  let file = ICD11_FILE;
  if (!file) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icd11-'));
    const zip = path.join(dir, 'st.zip');
    const url = `https://icdcdn.who.int/static/releasefiles/${ICD11_RELEASE}/SimpleTabulation-ICD-11-MMS-en.zip`;
    fs.writeFileSync(zip, Buffer.from(await (await http(url)).arrayBuffer()));
    file = path.join(dir, 'SimpleTabulation-ICD-11-MMS-en.txt');
    fs.writeFileSync(file, execFileSync('unzip', ['-p', zip, 'SimpleTabulation-ICD-11-MMS-en.txt'], { maxBuffer: 1 << 28 }));
  }
  const table = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(1)) {
    const a = line.split('\t');
    if (a.length > 5 && a[2]) table[a[2]] = a[4].replace(/^"|"$/g, '').replace(/""/g, '"').replace(/^[- ]+/, '');
  }
  return table;
}
async function verifyIcd11(data) {
  let table;
  try { table = await loadIcd11Table(); }
  catch (e) { add('icd11', null, '', 'error', `ICD-11 ${ICD11_RELEASE} 릴리스 표를 준비하지 못함: ${e.message} (표를 직접 내려받아 --icd11-file 로 지정)`); return; }
  for (const c of data.filter(c => c.icd11.code)) {
    const t = table[c.icd11.code];
    if (t === undefined) add('icd11', c, c.icd11.code, 'diff', `ICD-11 ${ICD11_RELEASE}에 코드 없음`);
    else add('icd11', c, c.icd11.code, t === c.icd11.name ? 'ok' : 'diff', t === c.icd11.name ? '' : `명칭: 앱 “${c.icd11.name}” / 원본 “${t}”`);
  }
}

/* ---------------- SNOMED CT / ICNP (Snowstorm) ---------------- */
const ssGet = async p => (await http(SNOWSTORM + p, { headers: { Accept: 'application/json', 'Accept-Language': 'en' } })).json();
async function verifySnomed(data) {
  if (!SNOWSTORM) { add('snomed', null, '', 'skip', '--snowstorm 주소가 없어 건너뜀'); return; }
  const br = encodeURIComponent(SNOMED_BRANCH).replace(/%2F/g, '/');
  for (const c of data.filter(c => c.snomed.id)) {
    try {
      await sleep(DELAY_MS);
      const con = await ssGet(`/browser/${br}/concepts/${c.snomed.id}`);
      const diffs = [];
      if (!con.active) diffs.push('비활성(inactive) 개념');
      if (con.pt && con.pt.term !== c.snomed.pt) diffs.push(`선호용어: 앱 “${c.snomed.pt}” / 원본 “${con.pt.term}”`);
      if (c.snomed.fsn && con.fsn && con.fsn.term !== c.snomed.fsn) diffs.push(`FSN: 앱 “${c.snomed.fsn}” / 원본 “${con.fsn.term}”`);
      await sleep(DELAY_MS);
      const parents = await ssGet(`/browser/${br}/concepts/${c.snomed.id}/parents?form=inferred`);
      const off = parents.map(p => String(p.conceptId)).sort().join(','), app = c.snomed.parents.map(p => p.id).sort().join(',');
      if (off !== app) diffs.push(`부모: 앱 [${app}] / 원본 [${off}]`);
      add('snomed', c, c.snomed.id, diffs.length ? 'diff' : 'ok', diffs.join(' | '));
    } catch (e) { add('snomed', c, c.snomed.id, 'error', '조회 실패: ' + e.message); }
  }
}
async function verifyIcnp(data) {
  if (!SNOWSTORM) { add('icnp', null, '', 'skip', '--snowstorm 주소가 없어 건너뜀'); return; }
  const rows = data.filter(c => c.icnp.code);
  const ids = [...new Set(rows.map(c => c.icnp.code))];
  try {
    const br = encodeURIComponent(ICNP_BRANCH).replace(/%2F/g, '/');
    const ecl = `(${ICNP_REFSETS.map(r => '^' + r).join(' OR ')}) AND (${ids.join(' OR ')})`;
    const res = await ssGet(`/${br}/concepts?activeFilter=true&limit=200&ecl=${encodeURIComponent(ecl)}`);
    const found = Object.fromEntries((res.items || []).map(x => [String(x.conceptId), x.pt ? x.pt.term : '']));
    for (const c of rows) {
      const pt = found[c.icnp.code];
      if (pt === undefined) add('icnp', c, c.icnp.code, 'diff', 'ICNP 매핑 참조집합의 활성 구성원이 아님');
      else add('icnp', c, c.icnp.code, pt === c.icnp.name ? 'ok' : 'diff', pt === c.icnp.name ? '' : `명칭: 앱 “${c.icnp.name}” / 원본 “${pt}”`);
    }
  } catch (e) { add('icnp', null, '', 'error', '조회 실패: ' + e.message); }
}

/* ---------------- main ---------------- */
const STEPS = { kcd: ['KCD-9', verifyKcd], icd10: ['ICD-10', verifyIcd10], icd11: ['ICD-11', verifyIcd11], snomed: ['SNOMED CT', verifySnomed], icnp: ['ICNP', verifyIcnp] };
const data = loadData();
console.log(`대상 파일: ${path.relative(process.cwd(), FILE)} · 개념 ${data.length}개 · ${new Date().toISOString().slice(0, 10)}`);
for (const key of Object.keys(STEPS)) {
  if (!ONLY.includes(key)) continue;
  const [label, fn] = STEPS[key];
  process.stdout.write(`\n[${label}] 대조 중…\n`);
  await fn(data);
  const rs = results.filter(r => r.std === key);
  const n = s => rs.filter(r => r.status === s).length;
  console.log(`  일치 ${n('ok')} · 불일치 ${n('diff')} · 조회 실패 ${n('error')}${n('skip') ? ' · 건너뜀' : ''}`);
  for (const r of rs.filter(r => r.status !== 'ok')) console.log(`  - ${[r.id, r.concept, r.code].filter(Boolean).join(' ')}: ${r.detail}`);
}
if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify({ file: FILE, date: new Date().toISOString(), icd11Release: ICD11_RELEASE, results }, null, 1)); console.log(`\n보고서 저장: ${JSON_OUT}`); }
const bad = results.filter(r => r.status === 'diff' || r.status === 'error').length;
console.log(bad ? `\n확인이 필요한 항목 ${bad}건` : '\n확인이 필요한 항목 없음');
process.exit(bad ? 1 : 0);
