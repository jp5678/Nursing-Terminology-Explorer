#!/usr/bin/env node
/* =====================================================================
   간호 표준용어 탐색기 — 교수자 기본 PIN 바꾸기

   index.html 에는 PIN 자체가 아니라 PBKDF2-SHA256 해시만 들어 있습니다.
   이 스크립트는 새 PIN을 입력받아 index.html 의 DEFAULT_PIN_HASH 줄을 새 해시로 바꿉니다.
   PIN은 어디에도 저장·출력하지 않습니다.

   사용법 (Node.js 18 이상, 추가 패키지 불필요)
     node tools/set_pin.mjs          새 PIN을 물어봅니다 (숫자 4~12자리)
   그다음 index.html 을 커밋·배포하면 모든 접속자에게 새 PIN이 적용됩니다.

   주의
     - 교수자가 앱의 “PIN 변경”으로 바꾼 PIN은 그 브라우저에만 저장되며, 이 기본 PIN보다 우선합니다.
     - 숫자 PIN은 경우의 수가 적어, 해시가 공개된 이상 작정하고 대입하면 찾아낼 수 있습니다.
       자릿수가 길수록 오래 걸립니다. 학생 접근을 막는 간이 잠금으로만 쓰세요.
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html');
const LINE = /const DEFAULT_PIN_HASH = \{[^}]*\};/;
const html = fs.readFileSync(FILE, 'utf8');
const iter = Number((html.match(/const PIN_ITER = (\d+);/) || [])[1]);
if (!iter || !LINE.test(html)) { console.error('index.html 에서 PIN 설정(PIN_ITER, DEFAULT_PIN_HASH)을 찾을 수 없습니다.'); process.exit(1); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const pin = (await rl.question('새 PIN (숫자 4~12자리): ')).trim();
const again = (await rl.question('한 번 더 입력: ')).trim();
rl.close();
if (!/^\d{4,12}$/.test(pin)) { console.error('숫자 4~12자리로 입력하세요. 변경하지 않았습니다.'); process.exit(1); }
if (pin !== again) { console.error('두 입력이 다릅니다. 변경하지 않았습니다.'); process.exit(1); }

const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(pin, salt, iter, 32, 'sha256').toString('hex');
fs.writeFileSync(FILE, html.replace(LINE, `const DEFAULT_PIN_HASH = { salt:'${salt.toString('hex')}', hash:'${hash}' };`));
console.log('index.html 의 기본 PIN 해시를 바꿨습니다. 커밋·배포하면 적용됩니다.');
