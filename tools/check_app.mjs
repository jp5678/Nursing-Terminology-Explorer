#!/usr/bin/env node
/* =====================================================================
   간호 표준용어 탐색기 — 앱 자동 점검 스크립트

   index.html 을 실제 브라우저(Chromium)로 열어 다음을 점검합니다. 파일은 수정하지 않습니다.
     1. 데이터 무결성  개념·간호기록·퀴즈·매핑 사례가 서로 참조하는 ID·코드가 맞는지
     2. 정적 구조      중복 id, 존재하지 않는 대상을 가리키는 aria/label 연결
     3. 동작           모든 탭을 실제로 조작(전 개념 순회, 상호운용성 정답·오답, 간호기록 전 표현,
                       퀴즈 완주·형식별 채점·끌어다 놓기, 검증 미션, 교수자 진입·편집·추가)하며 스크립트 오류·가로 넘침·
                       이름 없는 버튼·레이블 없는 입력·undefined 노출 확인 (데스크톱 1280px, 모바일 360px)
     4. 접근성         axe-core 로 WCAG 2 A/AA 검사 (라이트·다크, 전 탭)

   사용법 (Node.js 18 이상)
     npm install                     처음 한 번: playwright, axe-core 설치
     npx playwright install chromium 처음 한 번: 브라우저 설치
     node tools/check_app.mjs        전체 점검 (문제가 있으면 종료 코드 1)
     node tools/check_app.mjs --no-axe      접근성 검사 생략
     node tools/check_app.mjs --file ./다른파일.html

   참고
     - 교수자 모드 점검은 실제 PIN을 쓰지 않습니다. 점검용 사본에서만 PIN 해시를 시험용 값으로 바꿉니다.
     - 외부 요청(글꼴 등)은 모두 차단하고 실행하므로 인터넷이 필요 없습니다.
     - 용어 데이터를 공식 원본과 대조하는 일은 tools/verify_terminology.mjs 가 맡습니다.
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const FILE = path.resolve(opt('file', path.join(ROOT, 'index.html')));
const USE_AXE = !args.includes('--no-axe');
const ORIGIN = 'http://localhost:4173/';      // localhost 는 보안 컨텍스트 → PIN 해시(crypto.subtle) 동작
const TEST_PIN = '13572468';
/* 해설에 일부러 실은 참고 코드(앱 데이터에 없는 개념). SNOMED CT International 2026-11-01 에서 확인:
   399912005 Pressure ulcer(비활성), 25458004 Acute gastritis, 281794004 Viral URI, 54150009 URI */
const REFERENCE_CODES = ['399912005', '25458004', '281794004', '54150009'];

let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.error('playwright 를 찾을 수 없습니다. 먼저 "npm install" 을 실행하세요.'); process.exit(2); }
let axeSrc = '';
if (USE_AXE) {
  try { axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); }
  catch { console.warn('axe-core 가 없어 접근성 검사를 건너뜁니다. ("npm install" 후 다시 실행)'); }
}

/* ---------- 점검용 사본 만들기 (원본 파일은 건드리지 않음) ---------- */
let html = fs.readFileSync(FILE, 'utf8');
const TAIL = '})();\n</script>\n</body>';
if (!html.includes(TAIL)) { console.error('index.html 끝부분 구조가 바뀌어 점검용 훅을 넣을 수 없습니다.'); process.exit(2); }
html = html.replace(TAIL, 'window.__dbg = { TERMINOLOGY_DATA, RECORDS, INTEROP_TERMS, INTEROP_TARGETS, INTEROP_EXTRA, MISMATCH, MM_TYPES, QUIZ_POOL, QZ, QZ_TYPE, getConcept, searchConcepts, parseRecord };\n' + TAIL);
const iter = Number((html.match(/const PIN_ITER = (\d+);/) || [])[1]);
const pinLine = /const DEFAULT_PIN_HASH = \{[^}]*\};/;
if (!iter || !pinLine.test(html)) { console.error('PIN 해시 설정(PIN_ITER, DEFAULT_PIN_HASH)을 찾을 수 없습니다.'); process.exit(2); }
{
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(TEST_PIN, salt, iter, 32, 'sha256').toString('hex');
  html = html.replace(pinLine, `const DEFAULT_PIN_HASH = { salt:'${salt.toString('hex')}', hash:'${hash}' };`);
}

const issues = [];
const note = m => issues.push(m);
const browser = await chromium.launch();
async function open(viewport) {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  p.on('pageerror', e => note('스크립트 오류: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/net::ERR|Failed to load resource/.test(m.text())) note('콘솔 오류: ' + m.text()); });
  await p.route('**/*', r => r.request().url() === ORIGIN ? r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }) : r.abort());
  await p.goto(ORIGIN);
  return p;
}
const answerAny = async p => {
  if (await p.locator('#quizBox [data-ans]').count()) return p.locator('#quizBox [data-ans]').first().click();
  if (await p.locator('#quizBox [data-multi]').count()) { await p.locator('#quizBox [data-multi]').first().click(); return p.click('#qzSubmit'); }
  for (let g = 0; g < 30 && await p.locator('.qz-pool [data-chip]').count(); g++) {
    await p.locator('.qz-pool [data-chip]').first().click();
    const empty = p.locator('.qz-target:not(:has(.drop [data-chip])) .tg-btn');
    await ((await empty.count()) ? empty.first() : p.locator('.tg-btn').first()).click();
  }
  return p.click('#qzSubmit');
};
const enterInstructor = async p => { await p.click('#lockBtn'); await p.fill('#pinInput', TEST_PIN); await p.keyboard.press('Enter'); await p.waitForSelector('#panel-admin:not([hidden])', { timeout: 15000 }); };

try {
  /* ================= 1. 데이터 무결성 ================= */
  let p = await open({ width: 1280, height: 900 });
  (await p.evaluate((REF) => {
    const d = window.__dbg, out = [];
    const ids = d.TERMINOLOGY_DATA.map(c => c.id);
    if (new Set(ids).size !== ids.length) out.push('개념 ID 중복');
    const sn = d.TERMINOLOGY_DATA.map(c => c.snomed && c.snomed.id).filter(Boolean);
    const dupSn = sn.filter((x, i) => sn.indexOf(x) !== i); if (dupSn.length) out.push('SNOMED CT ID 중복: ' + dupSn);
    const known = code => d.TERMINOLOGY_DATA.some(x => x.snomed.id === code || x.icnp.code === code) || REF.includes(code);
    const has = id => !!d.getConcept(id) || !!d.INTEROP_EXTRA[id];
    d.TERMINOLOGY_DATA.forEach(c => {
      if (!/^[\w-]+$/.test(c.id)) out.push(c.id + ' ID 형식');
      if (c.snomed.id && !/^\d{6,18}$/.test(c.snomed.id)) out.push(c.id + ' SNOMED CT ID 형식');
      (c.snomed.parents || []).forEach(q => { if (!/^\d{6,18}$/.test(q.id)) out.push(c.id + ' 부모 ID 형식 ' + q.id); });
      if (c.kcd9.code && (!c.kcd9.chapter || !c.kcd9.block || !c.kcd9.name)) out.push(c.id + ' KCD 장·블록·명칭 누락');
      if (!c.concept_ko || !c.concept_en || !c.category) out.push(c.id + ' 기본 필드 누락');
      if (!['disorder', 'finding', 'procedure', 'event'].includes(c.concept_type)) out.push(c.id + ' 유형 오류');
      if (c.snomed.semantic_tag && c.snomed.fsn && !c.snomed.fsn.endsWith('(' + c.snomed.semantic_tag + ')')) out.push(c.id + ' FSN과 의미 태그 불일치');
      if (c.snomed.semantic_tag && c.snomed.semantic_tag !== c.concept_type) out.push(c.id + ' 유형과 의미 태그 불일치');
    });
    d.RECORDS.forEach(r => {
      const keys = d.parseRecord(r).filter(s => s.key).map(s => s.key);
      if (new Set(keys).size !== keys.length) out.push(r.id + ' 표현 키 중복');
      keys.forEach(k => { if (!r.items[k] && !r.distractors[k]) out.push(r.id + ' 정의되지 않은 키 ' + k); });
      Object.keys(r.items).concat(Object.keys(r.distractors)).forEach(k => { if (!keys.includes(k)) out.push(r.id + ' 본문에 없는 키 ' + k); });
      Object.entries(r.items).forEach(([k, it]) => {
        if (!it.opts.includes(it.c)) out.push(`${r.id}.${k} 정답이 보기에 없음`);
        if (new Set(it.opts).size !== it.opts.length) out.push(`${r.id}.${k} 보기 중복`);
        it.opts.forEach(o => { if (!d.getConcept(o)) out.push(`${r.id}.${k} 없는 개념 ${o}`); });
        (it.why.match(/\b\d{6,18}\b/g) || []).forEach(code => { if (!known(code)) out.push(`${r.id}.${k} 해설의 코드 ${code} 가 데이터·참고 코드 목록에 없음`); });
      });
    });
    d.INTEROP_TERMS.forEach(t => { if (!has(t.ans)) out.push('상호운용성 ' + t.id + ' 정답 개념 없음'); if (!d.INTEROP_TARGETS.includes(t.ans)) out.push('상호운용성 ' + t.id + ' 정답이 카드 목록에 없음'); });
    d.INTEROP_TARGETS.forEach(t => { if (!has(t)) out.push('상호운용성 카드 개념 없음 ' + t); });
    d.MISMATCH.forEach(m => {
      const c = d.getConcept(m.cid); if (!c) out.push('매핑 불일치 코너 개념 없음 ' + m.cid); if (!d.MM_TYPES[m.t]) out.push('매핑 불일치 유형 없음 ' + m.t);
      const code = (m.sn.match(/^\d+/) || [])[0]; if (c && code && code !== c.snomed.id) out.push(`매핑 불일치 코너 ${m.cid} SNOMED ${code} ≠ 데이터 ${c.snomed.id}`);
    });
    const qids = d.QUIZ_POOL.map(q => q.id); if (new Set(qids).size !== qids.length) out.push('퀴즈 ID 중복');
    if (d.QUIZ_POOL.length < 10) out.push('퀴즈 문항이 10개 미만');
    Object.keys(d.QZ_TYPE).forEach(t => { if (!d.QUIZ_POOL.some(q => q.type === t)) out.push('퀴즈에 ' + d.QZ_TYPE[t] + ' 형식 문항이 없음'); });
    const said = (document.querySelector('#panel-quiz .panel-head').textContent.match(/문항 풀 (\d+)개/) || [])[1];
    if (said && Number(said) !== d.QUIZ_POOL.length) out.push(`퀴즈 안내문의 문항 수(${said})와 실제 문항 수(${d.QUIZ_POOL.length})가 다름`);
    d.QUIZ_POOL.forEach(q => {
      const uniq = a => new Set(a).size === a.length;
      if (!d.QZ_TYPE[q.type]) out.push(q.id + ' 알 수 없는 문항 형식 ' + q.type);
      if (!q.q || !q.exp) out.push(q.id + ' 문제 또는 해설 누락');
      if (q.type === 'ox' && !['O', 'X'].includes(q.a)) out.push(q.id + ' O/X 정답 오류');
      if (q.type === 'mc' || q.type === 'multi') {
        if (!Array.isArray(q.opts) || q.opts.length !== 5) out.push(q.id + ' 보기가 5개가 아님 (4지 선다 금지)');
        else if (!uniq(q.opts)) out.push(q.id + ' 보기 중복');
      }
      if (q.type === 'mc' && !(q.a >= 0 && q.a < q.opts.length)) out.push(q.id + ' 정답 인덱스 오류');
      if (q.type === 'multi' && !(Array.isArray(q.a) && q.a.length >= 2 && q.a.length < q.opts.length && uniq(q.a) && q.a.every(x => x >= 0 && x < q.opts.length))) out.push(q.id + ' 복수 선택 정답 오류');
      if (q.type === 'match' && !(Array.isArray(q.pairs) && q.pairs.length >= 3 && uniq(q.pairs.map(x => x[0])) && uniq(q.pairs.map(x => x[1])))) out.push(q.id + ' 짝짓기 쌍 오류(3쌍 이상, 중복 없음)');
      if (q.type === 'bin' && !(Array.isArray(q.bins) && q.bins.length >= 2 && Array.isArray(q.items) && uniq(q.items.map(x => x[0])) && q.items.every(x => x[1] >= 0 && x[1] < q.bins.length) && q.bins.every((_, bi) => q.items.some(x => x[1] === bi)))) out.push(q.id + ' 분류하기 항목 오류');
      const words = (q.opts || []).concat((q.pairs || []).flat(), q.bins || [], (q.items || []).map(x => x[0]));
      ((q.q + ' ' + q.exp + ' ' + words.join(' ')).match(/\b\d{6,18}\b/g) || []).forEach(code => { if (!known(code)) out.push(`${q.id} 코드 ${code} 가 데이터·참고 코드 목록에 없음`); });
    });
    const first = q => (d.searchConcepts(q)[0] || {}).concept_ko;
    [['E11', '2형 당뇨병'], ['44054006', '2형 당뇨병'], ['DM', '2형 당뇨병'], ['5A11', '2형 당뇨병'], ['htn', '본태성 고혈압'], ['ㄴㅅ', '낙상']]
      .forEach(([q, want]) => { if (d.getConcept('C001') && first(q) !== want) out.push(`검색 “${q}” 1순위 = ${first(q)} (기대: ${want})`); });
    return out;
  }, REFERENCE_CODES)).forEach(x => note('[데이터] ' + x));

  /* ================= 2. 정적 구조 ================= */
  (await p.evaluate(() => {
    const out = [];
    const ids = [...document.querySelectorAll('[id]')].map(e => e.id);
    const dup = ids.filter((x, i) => ids.indexOf(x) !== i); if (dup.length) out.push('중복 id: ' + [...new Set(dup)]);
    document.querySelectorAll('[aria-controls],[aria-labelledby],[aria-describedby],label[for]').forEach(e => {
      ['aria-controls', 'aria-labelledby', 'aria-describedby', 'for'].forEach(a => { const v = e.getAttribute(a); if (v && !document.getElementById(v)) out.push(a + ' 대상 없음: ' + v); });
    });
    return out;
  })).forEach(x => note('[구조] ' + x));
  await p.close();

  /* ================= 3. 동작 (데스크톱 + 모바일) ================= */
  for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 740 }]) {
    p = await open(viewport);
    const tag = `[동작 ${viewport.width}px] `;
    const overflow = async where => {
      const r = await p.evaluate(() => {
        const sw = document.documentElement.scrollWidth, w = window.innerWidth, bad = [];
        if (sw > w + 1) document.querySelectorAll('main *').forEach(e => { const b = e.getBoundingClientRect(); if (b.width && b.right > w + 1 && !e.closest('.table-scroll,.tabs,.svg-wrap,pre')) bad.push(e.tagName + '.' + e.className); });
        return { sw, w, bad: bad.slice(0, 5) };
      });
      if (r.sw > r.w + 1) note(`${tag}${where}: 가로 넘침 ${r.sw} > ${r.w} ${r.bad.join(' | ')}`);
    };
    const check = async where => {
      (await p.evaluate(() => {
        const out = [], ids = [...document.querySelectorAll('[id]')].map(e => e.id);
        const dup = ids.filter((x, i) => ids.indexOf(x) !== i); if (dup.length) out.push('중복 id ' + [...new Set(dup)].slice(0, 5));
        document.querySelectorAll('main button:not([hidden]),#modalRoot button').forEach(b => { if (!b.textContent.trim() && !b.getAttribute('aria-label')) out.push('이름 없는 버튼'); });
        document.querySelectorAll('main input,main select,main textarea,#modalRoot input,#modalRoot select,#modalRoot textarea').forEach(i => { if (!i.getAttribute('aria-label') && !(i.id && document.querySelector('label[for="' + CSS.escape(i.id) + '"]')) && !i.closest('label')) out.push('레이블 없는 입력 ' + i.id); });
        if (/undefined|\bNaN\b|\[object Object\]/.test(document.querySelector('main').innerText)) out.push('화면에 undefined/NaN 노출');
        return out;
      })).forEach(x => note(`${tag}${where}: ${x}`));
    };
    // 학습 진도: 탭을 열어 보는 것만으로는 오르지 않아야 함
    const pct = async () => Number((await p.innerText('#progressText')).replace('%', ''));
    if (await pct() !== 0) note(`${tag}학습 진도: 아무것도 하지 않았는데 ${await pct()}%`);
    for (const t of ['hierarchy', 'interop', 'records', 'quiz', 'overview', 'verify', 'rosetta']) await p.click('#tab-' + t);
    if (await pct() !== 0) note(`${tag}학습 진도: 탭 방문만으로 ${await pct()}%로 오름`);
    await p.locator('#resultList .result').first().click();
    if (await pct() <= 0) note(tag + '학습 진도: 개념을 직접 골라도 오르지 않음');
    // 개념 검색·비교
    await p.fill('#searchInput', 'zzzz'); await check('검색(결과 없음)'); await p.fill('#searchInput', '');
    const n = await p.locator('#resultList .result').count();
    for (let i = 0; i < n; i++) await p.locator('#resultList .result').nth(i).click();
    await check(`개념 검색(전 개념 ${n}개)`); await overflow('개념 검색');
    for (const chip of await p.locator('#catFilters .chip').all()) await chip.click();
    for (const chip of await p.locator('#typeFilters .chip').all()) await chip.click();
    // 계층 탐색
    await p.click('#tab-hierarchy');
    for (const v of await p.locator('#hierSelect option').evaluateAll(o => o.map(x => x.value))) await p.selectOption('#hierSelect', v);
    await p.locator('#icdTree .leaf').first().click(); await check('계층 탐색'); await overflow('계층 탐색');
    // 상호운용성: 정답 흐름과 오답 흐름
    await p.click('#tab-interop');
    const terms = await p.evaluate(() => window.__dbg.INTEROP_TERMS.map(t => [t.id, t.ans]));
    for (const [tid, ans] of terms) { await p.click(`[data-term="${tid}"]`); await p.click(`[data-target="${ans}"]`, { position: { x: 5, y: 5 } }); }
    await p.click('#interopCheck'); await p.waitForTimeout(300);
    if (!(await p.locator('#interopResult .success').count())) note(tag + '상호운용성: 정답 매핑 후 성공 화면 없음');
    await check('상호운용성(성공)'); await overflow('상호운용성(성공)');
    await p.click('#interopReset');
    const wrongTarget = await p.evaluate(() => window.__dbg.INTEROP_TARGETS[1]);
    for (const [tid] of terms) { await p.click(`[data-term="${tid}"]`); await p.click(`[data-target="${wrongTarget}"]`, { position: { x: 5, y: 5 } }); }
    await p.click('#interopCheck'); await p.waitForTimeout(200);
    if (!(await p.locator('#interopResult .problem').count())) note(tag + '상호운용성: 오답 화면 없음');
    await check('상호운용성(오답)');
    // 간호기록 코딩: 모든 기록의 모든 표현
    await p.click('#tab-records');
    const recs = await p.evaluate(() => window.__dbg.RECORDS.map(r => ({ id: r.id, d: Object.keys(r.distractors), items: Object.entries(r.items).map(([k, v]) => [k, v.c, v.opts.find(o => o !== v.c)]) })));
    for (const r of recs) {
      await p.click(`[data-rec="${r.id}"]`);
      for (const dk of r.d) await p.click(`#recNote [data-key="${dk}"]`);
      for (const [k, ok, wrong] of r.items) { await p.click(`#recNote [data-key="${k}"]`); await p.click(`#recWork [data-opt="${wrong}"]`); await p.click(`#recWork [data-opt="${ok}"]`); }
      if (await p.locator('#recExtracted tbody tr').count() !== r.items.length) note(`${tag}간호기록 ${r.id}: 추출표 행 수 불일치`);
      await check('간호기록 ' + r.id);
    }
    await overflow('간호기록');
    // 퀴즈 완주 + 오답 재풀이
    await p.click('#tab-quiz'); await p.click('#qzStart');
    const seenTypes = new Set();
    for (let i = 0; i < 10; i++) { seenTypes.add(await p.evaluate(() => window.__dbg.QZ.list[window.__dbg.QZ.i].type)); await check('퀴즈 문항(응답 전)'); await answerAny(p); await check('퀴즈 문항(응답 후)'); await overflow('퀴즈 문항'); await p.click('#qzNext'); }
    if (seenTypes.size < 5) note(`${tag}퀴즈: 한 회에 형식 5종이 모두 나오지 않음 (${[...seenTypes]})`);
    await check('퀴즈 결과'); await overflow('퀴즈');
    if (await p.locator('#qzRetry:not([disabled])').count()) { await p.click('#qzRetry'); await answerAny(p); }
    // 정답으로 완주: 형식별 채점이 맞으면 10점
    await p.reload(); await p.click('#tab-quiz'); await p.click('#qzStart');
    let dragged = false;
    for (let i = 0; i < 10; i++) {
      const q = await p.evaluate(() => { const z = window.__dbg.QZ, x = z.list[z.i]; return { type: x.type, a: x.a, key: x.key }; });
      if (q.type === 'ox' || q.type === 'mc') await p.click(`#quizBox [data-ans="${q.a}"]`);
      else if (q.type === 'multi') { for (const oi of q.a) await p.click(`#quizBox [data-multi="${oi}"]`); await p.click('#qzSubmit'); }
      else {
        for (let ci = 0; ci < q.key.length; ci++) {
          if (!dragged && viewport.width > 800) { await p.locator(`.qz-pool [data-chip="${ci}"]`).dragTo(p.locator(`.qz-target[data-tg="${q.key[ci]}"]`)); dragged = true;
            if (!(await p.locator(`.qz-target[data-tg="${q.key[ci]}"] [data-chip="${ci}"]`).count())) note(tag + '퀴즈: 끌어다 놓기가 동작하지 않음'); }
          if (await p.locator(`.qz-pool [data-chip="${ci}"]`).count()) { await p.click(`.qz-pool [data-chip="${ci}"]`); await p.click(`[data-tgbtn="${q.key[ci]}"]`); }
        }
        await p.click('#qzSubmit');
      }
      if (!(await p.locator('#qzFb.ok').count())) note(`${tag}퀴즈: 정답을 넣었는데 오답 처리됨 (${q.type})`);
      await p.click('#qzNext');
    }
    if ((await p.locator('#quizBox .score-big').innerText()).replace(/\s/g, '') !== '10/10') note(tag + '퀴즈: 전부 정답인데 10점이 아님');
    // 표준용어 개요
    await p.click('#tab-overview');
    for (const chip of await p.locator('#mmFilters .chip').all()) await chip.click();
    await p.locator('#mmFilters .chip').first().click(); await check('표준용어 개요'); await overflow('표준용어 개요');
    await p.locator('#mmList [data-open]').first().click();
    if (!(await p.isVisible('#panel-rosetta'))) note(tag + '표준용어 개요: “개념 보기” 이동 실패');
    await p.click('#tab-overview'); await p.click('#ovToRosetta');
    if (await p.evaluate(() => document.activeElement.id) !== 'searchInput') note(tag + '표준용어 개요: 검색창 이동 실패');
    // 검증 미션
    await p.click('#tab-verify'); await p.click('#vAssign');
    if (await p.locator('#vList .v-task').count() !== 5) note(tag + '검증 미션: 배정 과제 수가 5가 아님');
    for (let i = 0; i < 5; i++) await p.locator('#vList .v-task').nth(i).locator('[data-vst="mismatch"]').click();
    await p.locator('#vList input[data-vf="value"]').first().fill('점검용 값');
    await p.click('#vExportDocx');
    if (await p.evaluate(() => document.activeElement.id) !== 'vCls') note(tag + '검증 미션: 제출자 미입력 시 내보내기가 막히지 않음');
    await p.fill('#vCls', 'A반'); await p.fill('#vSid', '20260000'); await p.fill('#vName', '점검'); await p.locator('#vName').press('Tab');
    for (const [btn, ext] of [['#vExportJson', '.json'], ['#vExportCsv', '.csv'], ['#vExportDocx', '.docx']]) {
      p.once('dialog', dlg => dlg.accept());
      const dl = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click(btn)]).then(r => r[0]).catch(() => null);
      if (!dl) note(`${tag}검증 미션: ${ext} 내보내기 실패`);
    }
    await check('검증 미션'); await overflow('검증 미션'); await p.click('#vAll');
    // 교수자 모드
    await p.click('#lockBtn'); await p.fill('#pinInput', '0000'); await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.querySelector('#pinErr') && document.querySelector('#pinErr').textContent.trim(), null, { timeout: 15000 }).catch(() => note(tag + '교수자: 틀린 PIN 오류 미표시'));
    if (await p.isVisible('#tab-admin')) note(tag + '교수자: 틀린 PIN으로 진입됨');
    await p.fill('#pinInput', TEST_PIN); await p.keyboard.press('Enter');
    await p.waitForSelector('#panel-admin:not([hidden])', { timeout: 15000 }).catch(() => note(tag + '교수자: 진입 실패'));
    await check('교수자'); await overflow('교수자');
    await p.locator('[data-edit]').first().click(); await check('편집 창'); await p.locator('#editForm button[type=submit]').click();
    await p.click('#adAdd'); await p.fill('#f-ko', '점검용 개념'); await p.fill('#f-s-id', '12'); await p.locator('#editForm button[type=submit]').click();
    if (!(await p.locator('#editErr').innerText()).trim()) note(tag + '교수자: SNOMED CT ID 형식 오류 미표시');
    await p.fill('#f-s-id', ''); await p.locator('#editForm button[type=submit]').click();
    await p.click('#tab-rosetta'); await p.fill('#searchInput', '점검용 개념'); await check('추가한 개념 상세');
    await p.click('#tab-hierarchy'); await check('추가한 개념 포함 계층');
    await p.click('#lockBtn');
    if (await p.isVisible('#tab-admin')) note(tag + '교수자: 종료 후에도 탭이 남음');
    // 키보드 탭 이동, 진도 창, 테마
    await p.focus('#tab-rosetta'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('End'); await p.keyboard.press('Home');
    // 위 활동을 모두 마친 뒤의 진도 (매핑 불일치 사례만 1/3)
    if (await pct() < 90) note(`${tag}학습 진도: 활동을 대부분 마쳤는데 ${await pct()}%`);
    await p.click('#progressBtn'); await check('학습 진도 창');
    const go = p.locator('#modalRoot [data-go]').first();
    if (await go.count()) { const dest = await go.getAttribute('data-go'); await go.click(); if (!(await p.isVisible('#panel-' + dest))) note(tag + '학습 진도: “하러 가기” 이동 실패'); }
    else await p.keyboard.press('Escape');
    await p.click('#themeBtn'); await overflow('다크 모드');
    await p.close();
  }

  /* ================= 4. 접근성 (axe-core) ================= */
  if (axeSrc) {
    const seen = new Map();
    for (const theme of ['light', 'dark']) {
      p = await open({ width: 1280, height: 900 });
      if (theme === 'dark') await p.click('#themeBtn');
      await p.addScriptTag({ content: axeSrc });
      const run = async where => {
        // 알림창(#toast)은 사라지는 도중에 색이 섞여 오탐이 나므로 제외
        const v = await p.evaluate(async () => (await axe.run({ exclude: ['#toast'] }, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] })).violations
          .map(x => ({ id: x.id, impact: x.impact, help: x.help, n: x.nodes.length, ex: x.nodes.slice(0, 2).map(nd => nd.html.slice(0, 140) + (nd.any[0] ? ' ← ' + nd.any[0].message.slice(0, 120) : '')) })));
        v.forEach(x => { const k = `${theme}|${x.id}|${x.ex[0].slice(0, 60)}`; if (!seen.has(k)) seen.set(k, `[접근성 ${theme}] ${where}: ${x.id} (${x.impact}, ${x.n}건) ${x.help}\n      ${x.ex.join('\n      ')}`); });
      };
      await run('개념 검색');
      await p.click('#tab-hierarchy'); await run('계층 탐색');
      await p.click('#tab-interop'); await p.locator('.term').first().click(); await run('상호운용성');
      await p.click('#tab-records'); await p.locator('#recNote .phrase').first().click(); await p.locator('#recWork .opt').first().click(); await run('간호기록');
      await p.click('#tab-quiz'); await run('퀴즈'); await p.click('#qzStart');
      for (let i = 0; i < 10; i++) {
        const t = await p.evaluate(() => window.__dbg.QZ.list[window.__dbg.QZ.i].type);
        if (await p.locator('.qz-pool [data-chip]').count()) { await p.locator('.qz-pool [data-chip]').first().click(); await p.locator('.tg-btn').first().click(); await p.locator('.qz-pool [data-chip]').first().click(); }
        await run('퀴즈 문항 ' + t + '(응답 전)'); await answerAny(p); await run('퀴즈 문항 ' + t + '(응답 후)'); await p.click('#qzNext');
      }
      await run('퀴즈 결과');
      await p.click('#tab-overview'); await run('표준용어 개요');
      await p.click('#tab-verify'); await p.locator('[data-vst="mismatch"]').first().click(); await run('검증 미션');
      await p.click('#progressBtn'); await run('학습 진도 창'); await p.keyboard.press('Escape');
      await p.click('#lockBtn'); await run('PIN 창'); await p.keyboard.press('Escape');
      await enterInstructor(p); await run('교수자');
      await p.locator('[data-edit]').first().click(); await run('편집 창');
      await p.close();
    }
    seen.forEach(v => note(v));
  }
} catch (e) {
  note('점검 중단: ' + (e && e.message ? e.message.split('\n')[0] : e));
} finally {
  await browser.close();
}

if (issues.length) { console.log(`문제 ${issues.length}건\n` + issues.map(x => ' - ' + x).join('\n')); process.exit(1); }
console.log(`문제 없음 — 데이터·구조·동작(1280px, 360px)${axeSrc ? '·접근성(라이트, 다크)' : ''} 점검 통과`);
