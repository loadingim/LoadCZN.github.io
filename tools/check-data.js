#!/usr/bin/env node
// 데이터 무결성 검사: data/*.json 사이의 참조(장비·파트너·세트·덱·이미지)와 형식을 확인한다.
//   실행: node tools/check-data.js
//   오류가 하나라도 있으면 종료 코드 1, 경고만 있으면 0
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const D = f => path.join(ROOT, "data", f);
const errors = [], warns = [];
const err = m => errors.push(m), warn = m => warns.push(m);

function load(file) {
  try { return JSON.parse(fs.readFileSync(D(file), "utf8").replace(/^﻿/, "")); }
  catch (e) { err(`${file}: JSON 형식 오류 — ${e.message}`); return null; }
}
const list = (j, key) => Array.isArray(j) ? j : (j && Array.isArray(j[key]) ? j[key] : []);

const ATTRS = ["열정", "질서", "정의", "공허", "본능"];
const JOBS = ["스트라이커", "뱅가드", "헌터", "레인저", "사이오닉", "컨트롤러"];
const SLOTS = ["무기", "방어구", "장신구"];
const RARITY = ["신화", "전설", "희귀"];
const EQ_GROUPS = ["공용", "시즌 공용", "투기장", "미확인 구역", "세력"];
// index.html 의 GEAR_ALIAS 와 같은 줄임 표기
const GEAR_ALIAS = { "타이탄 강화복": "타이탄 전투 강화복", "사이오닉 강화복": "사이오닉 전투 강화복" };
// 전투원 데이터에서 2세트를 능력치 이름으로 줄여 쓴 표기 → 실제 세트 이름
const SET2_NICK = { "공격력": "검은 날개", "치명 피해": "집행자의 도구", "체력": "치유사의 행적", "방어력": "테트라의 권위", "기본 공격": "세스의 스카라베", "저주": "저주받은 시체" };

const chars = list(load("combatants.json"), "combatants");
const equips = list(load("equipment.json"));
const partners = list(load("partners.json"), "partners");
const frags = load("fragments.json") || { sets: [] };
const kits = (load("kits.json") || {}).kits || {};
const teams = list(load("teams.json"), "teams");
const decks = list(load("decks.json"), "decks");
const gloss = list(load("glossary.json"));
const formula = fs.existsSync(D("formula.json")) ? load("formula.json") : null; // 계산기 자료 (없으면 건너뜀)

/* 장비 */
const eqByName = {};
equips.forEach(e => {
  if (eqByName[e.name]) err(`장비 이름 중복: ${e.name}`);
  eqByName[e.name] = e;
  if (!SLOTS.includes(e.slot)) err(`장비 ${e.name}: 부위 값 오류 '${e.slot}'`);
  if (!RARITY.includes(e.rarity)) err(`장비 ${e.name}: 등급 값 오류 '${e.rarity}'`);
  if (!EQ_GROUPS.includes(e.group)) err(`장비 ${e.name}: 획득 분류 오류 '${e.group}'`);
  if (!String(e.effect || "").trim()) err(`장비 ${e.name}: 효과 문구 없음`);
  if (!Array.isArray(e.chaos)) err(`장비 ${e.name}: chaos 가 배열이 아님`);
  if (!e.en) warn(`장비 ${e.name}: 영문 이름 없음`);
});

/* 파트너 */
const pByName = {};
const passiveLineOwner = {};
partners.forEach(p => {
  [p.name, ...(p.aliases || [])].forEach(n => { if (pByName[n]) err(`파트너 이름·별칭 중복: ${n}`); pByName[n] = p; });
  if (!JOBS.includes(p.cls)) err(`파트너 ${p.name}: 직업 값 오류 '${p.cls}'`);
  if (!p.lv60 || !("atk" in p.lv60)) err(`파트너 ${p.name}: 60레벨 능력치 없음`);
  const desc = (p.passive && p.passive.desc) || [];
  if (!desc.length) err(`파트너 ${p.name}: 패시브 설명 없음`);
  desc.forEach(line => {
    // 조건 없는 능력치 줄('담당 전투원의 공격력, 체력, 피해량이 …% 증가합니다.')은 여러 파트너가 같아도 정상
    if (/^담당 전투원의 [가-힣 ,]+(이|가) [\d/~.]+% 증가합니다\.?$/.test(line)) return;
    if (passiveLineOwner[line] && passiveLineOwner[line] !== p.name) err(`파트너 ${p.name}: 패시브 줄이 ${passiveLineOwner[line]}와 똑같음 (복사 실수 의심) — ${line.slice(0, 40)}…`);
    passiveLineOwner[line] = p.name;
  });
});

/* 기억의 조각 세트 */
const setByName = {};
(frags.sets || []).forEach(s => { setByName[s.name] = s; });
function checkSetItems(cid, items) {
  let pieces = 0;
  items.forEach(it => {
    if (it === "2세트 자유") { pieces += 2; return; }
    const m = String(it).match(/^(.+)\*(\d)$/);
    if (!m) { err(`전투원 ${cid}: 세트 표기 형식 오류 '${it}'`); return; }
    const name = SET2_NICK[m[1]] || m[1], n = Number(m[2]);
    const s = setByName[name];
    if (!s) err(`전투원 ${cid}: 없는 세트 '${m[1]}'`);
    else if (s.pieces !== n) err(`전투원 ${cid}: '${m[1]}'는 ${s.pieces}세트인데 *${n}로 적힘`);
    pieces += n;
  });
  if (pieces > 6) err(`전투원 ${cid}: 세트 조각 수 합이 ${pieces} (최대 6)`);
}

/* 전투원 */
const ids = new Set();
chars.forEach(c => {
  if (ids.has(c.id)) err(`전투원 id 중복: ${c.id}`);
  ids.add(c.id);
  ["id", "name", "name_ko", "job", "attr"].forEach(k => { if (!c[k]) err(`전투원 ${c.id}: ${k} 없음`); });
  if (!ATTRS.includes(c.attr)) err(`전투원 ${c.id}: 속성 값 오류 '${c.attr}'`);
  if (!JOBS.includes(c.job)) err(`전투원 ${c.id}: 직업 값 오류 '${c.job}'`);
  Object.entries(c.gear || {}).forEach(([slot, items]) => {
    if (!SLOTS.includes(slot)) err(`전투원 ${c.id}: 장비 칸 이름 오류 '${slot}'`);
    (items || []).forEach(x => {
      const n = String(x).replace(/\s*\(.*\)\s*$/, "").trim();
      const e = eqByName[GEAR_ALIAS[n] || n];
      if (!e) err(`전투원 ${c.id}: 장비 자료에 없는 추천 장비 '${x}'`);
      else if (e.slot !== slot) err(`전투원 ${c.id}: '${x}'는 ${e.slot}인데 ${slot} 칸에 있음`);
    });
  });
  (c.partners || []).forEach(n => { if (!pByName[n]) warn(`전투원 ${c.id}: 파트너 자료에 없는 이름 '${n}' (상세 링크 없이 이름만 표시됨)`); });
  (c.sets || []).forEach(s => checkSetItems(c.id, s.items || []));
  if (!kits[c.id]) warn(`전투원 ${c.id}: 고유 카드 자료(kits.json) 없음`);
  const img = ["webp", "png"].map(x => path.join(ROOT, "images", `${c.name}.${x}`));
  if (!img.some(f => fs.existsSync(f))) warn(`전투원 ${c.id}: 이미지 없음 (images/${c.name}.webp)`);
});

/* 고유 카드·번뜩임: 효과 목록에 대사·평가 문장이 섞였는지 (나무위키 옮길 때 자주 생김) */
const COMMENTARY = /(했다|된다|있다|없다|한다|이다|좋다|추천된다|권장된다)[.!]?\s*$|[!?]\s*$|~\s*[가-힣]*[!?]?$/;
Object.entries(kits).forEach(([cid, k]) => {
  if (!ids.has(cid)) err(`kits.json: 전투원 자료에 없는 id '${cid}'`);
  const scan = (where, lines) => (lines || []).forEach(l => { if (COMMENTARY.test(l) && !/[0-9]%/.test(l)) warn(`kits ${cid} ${where}: 효과가 아닌 문장 의심 — ${l.slice(0, 40)}`); });
  (k.cards || []).forEach(c => [c.base, ...(c.epiphany || [])].forEach(v => scan(`${c.title}${v.n ? " 번뜩임 " + v.n : ""}`, v.effect)));
  // 나무위키 틀의 자리표시('고유카드 1 카드 번뜩임 효과 설명입니다.', 비용 '_')가 그대로 옮겨졌는지
  (k.cards || []).forEach(c => [c.base, ...(c.epiphany || [])].forEach(v => {
    const where = `${c.title}${v.n ? " 번뜩임 " + v.n : ""}`;
    if ((v.effect || []).some(l => /효과 설명입/.test(l))) err(`kits ${cid} ${where}: 자리표시 문구가 남아 있음`);
    if (String(v.cost) === "_") err(`kits ${cid} ${where}: 비용이 자리표시('_')`);
  }));
  if (k.ego) scan("에고 스킬", k.ego.effect);
  (k.manifest || []).forEach(m => scan(`에고 발현 ${m.lv}`, m.effect));
  (k.potential || []).forEach(p => scan(`잠재력 ${p.id}`, p.effect));
});

/* 조합·덱 */
const deckByCode = {};
decks.forEach(k => {
  if (deckByCode[k.code]) err(`덱 코드 중복: ${k.code}`);
  deckByCode[k.code] = k;
  if (k.char && !ids.has(k.char)) err(`덱 ${k.code}: 없는 전투원 '${k.char}'`);
  ["image", "thumb"].forEach(f => { if (k[f] && !fs.existsSync(path.join(ROOT, k[f]))) err(`덱 ${k.code}: ${f} 파일 없음 (${k[f]})`); });
});
const teamIds = new Set();
teams.forEach(t => {
  if (teamIds.has(t.id)) err(`조합 id 중복: ${t.id}`);
  teamIds.add(t.id);
  (t.slots || []).forEach(s => {
    if (!ids.has(s.id)) err(`조합 ${t.id}: 없는 전투원 '${s.id}'`);
    if (s.deck) {
      const k = deckByCode[s.deck];
      if (!k) err(`조합 ${t.id}: 없는 덱 코드 '${s.deck}'`);
      else if (k.char !== s.id) err(`조합 ${t.id}: 덱 '${s.deck}'은 ${k.char}의 덱인데 ${s.id} 칸에 있음`);
    }
    (s.alts || []).forEach(a => { if (!ids.has(a)) warn(`조합 ${t.id}: 대체 전투원 '${a}' 없음`); });
  });
});

/* 효과 사전 */
const glNames = new Set();
gloss.forEach(g => { const n = g.name || g.en; if (glNames.has(n)) warn(`효과 사전 이름 중복: ${n}`); glNames.add(n); });

/* 계산식 자료 */
if (formula) {
  const orders = new Set();
  (formula.steps || []).forEach(s => {
    if (orders.has(s.order)) err(`formula.json: 단계 순서 중복 ${s.order}`);
    orders.add(s.order);
    if (!formula.statuses[s.status]) err(`formula.json: 단계 '${s.name}'의 검증 상태 '${s.status}'가 정의되지 않음`);
    (s.src || []).forEach(id => { if (!formula.sources[id]) err(`formula.json: 단계 '${s.name}'의 출처 '${id}' 없음`); });
  });
  (formula.cases || []).forEach(c => { if (!formula.sources[c.src]) err(`formula.json: 사례 '${c.id}'의 출처 '${c.src}' 없음`); });
}

console.log(`전투원 ${chars.length} · 장비 ${equips.length} · 파트너 ${partners.length} · 세트 ${(frags.sets || []).length} · 조합 ${teams.length} · 덱 ${decks.length} · 효과 ${gloss.length}`);
warns.forEach(m => console.log("  경고: " + m));
errors.forEach(m => console.log("  오류: " + m));
console.log(`결과: 오류 ${errors.length} · 경고 ${warns.length}`);
process.exit(errors.length ? 1 : 0);
