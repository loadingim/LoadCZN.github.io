#!/usr/bin/env node
// 피해량 계산식 검증: data/formula.json 의 실측 사례를 js/calc-core.js 로 다시 계산해 비교한다.
//   실행: node tools/test-calc.js
//   종료 코드 0 = 모든 사례 통과, 1 = 하나라도 어긋남
"use strict";
const path = require("path");
const fs = require("fs");
const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "js", "calc-core.js"));
const F = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "formula.json"), "utf8").replace(/^﻿/, ""));

let fail = 0, pass = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log("  ✗ " + msg); } };
const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps);

console.log("1) 실측 사례 (data/formula.json cases)");
for (const c of F.cases) {
  let got, want, line;
  if (c.kind === "coef") {
    const r = C.coefficient(c.input);
    const key = Object.keys(c.expect)[0];
    want = c.expect[key];
    got = key === "base" ? r.base : C.ceilShow(r[key]);
    const err = want ? Math.abs(got - want) / want * 100 : 0;
    line = `${c.id.padEnd(16)} ${String(key).padEnd(4)} 실측 ${want} · 계산 ${got} (원값 ${(key === "base" ? r.base : r[key]).toFixed(2)}) · 오차 ${err.toFixed(2)}%`;
    ok(got === want, `${c.id}: 기대 ${want}, 계산 ${got}`);
  } else if (c.kind === "ratio") {
    // 같은 입력에서 한 요소만 바꿨을 때의 배율을 계산식으로 구해, 실측 '전' 값에 곱한다.
    const baseIn = { atk: { status: 1000 }, base: 100 };
    const chg = c.change || {};
    const after = { ...baseIn, atk: { ...baseIn.atk, ...(chg.atk || {}) }, el: chg.el || 0, mech: chg.mech || 0 };
    const r0 = C.evaluate(baseIn).dmg.non, r1 = C.evaluate(after).dmg.non;
    const ratio = r1 / r0;
    got = C.roundShow(c.before * ratio);
    want = c.expect;
    const err = Math.abs(got - want) / want * 100;
    line = `${c.id.padEnd(16)} 배율 ×${ratio.toFixed(4)} · 실측 ${c.before}→${want} · 계산 ${got} · 오차 ${err.toFixed(2)}%`;
    // '전' 값 자체가 정수로 표시된 값이라 ±1 까지는 표시 반올림 차이로 본다.
    ok(Math.abs(got - want) <= 1, `${c.id}: 기대 ${want}, 계산 ${got}`);
  } else {
    line = `${c.id} (알 수 없는 종류 ${c.kind})`;
    ok(false, line);
  }
  console.log("  " + line);
}

console.log("2) 공격력 식 성질");
{
  // 스테이터스 공격력을 넣으면 같은 스테이터스가 다시 나와야 한다.
  const a = C.attack({ status: 1234, a: 44, b: 37, c: 90 });
  ok(near(a.status, 1234, 1e-6), "스테이터스 역산이 원래 값과 다름");
  // N, A, B, C 로 직접 계산한 값과 같아야 한다.
  const b = C.attack({ base: 530, partner: 155, flat: 40, a: 24, b: 12, c: 82 });
  ok(near(b.status, (530 + 155 + 40) * 1.24 * 1.12 + 82, 1e-9), "공격력 N·A·B·C 계산 오류");
  // A 그룹 안은 합연산: A 24% + 장비 18% = 42% 한 번 곱
  const c = C.attack({ base: 500, a: 42, b: 0, c: 0 });
  ok(near(c.status, 500 * 1.42, 1e-9), "A 그룹 합연산 오류");
  // 시즌 4 이전 동작: 심록·클로버가 최종 곱 (실측 사례 dc-verdant 등이 이 방식)
  const d = C.attack({ status: 1000, c: 90, d: 12, g: 10 });
  ok(near(d.final, 1000 * 1.12 * 1.1, 1e-9), "시즌 4 이전(최종 곱) 계산 오류");
  // 시즌 4(2026-07-29)부터: 심록·클로버도 A그룹 합연산 → 혼돈의 지적 18 + 클로버 10 = 한 번에 × 1.28
  const s4 = C.attack({ base: 500, a: 18 + 10, b: 0, c: 0 });
  ok(near(s4.status, 500 * 1.28, 1e-9), "시즌 4 A그룹 합연산 오류");
}

console.log("3) 계수 식 성질");
{
  const r = C.coefficient({ base: 200, M: 20, A: 20 });
  ok(near(r.hand, 260, 1e-9), "핸드 계수 = 200 × 1.2 + 20 이어야 함");
  // 잠재력 가산은 잠재력 곱보다 먼저
  ok(near(C.cardBase(100, 20, 20), 144, 1e-9), "잠재력 가산·곱 순서 오류");
  // 치명: 치명피해 150% → 1.5배, 기대값은 치명확률로 가중
  const k = C.coefficient({ base: 100, cr: 50, cd: 150 });
  ok(near(k.crit, 150, 1e-9) && near(k.exp, 125, 1e-9), "치명 배율·기대값 오류");
  // 표시 올림
  ok(C.ceilShow(226.6) === 227 && C.ceilShow(3011.25) === 3012 && C.ceilShow(180 * 1.12 + 25) === 227, "표시 올림 오류");
  ok(C.ceilShow(1692.0000000002) === 1692, "부동소수 오차 정리 실패");
  // 피해 감소·약화는 곱
  const w = C.coefficient({ base: 100, dr: 20, weaken: true });
  ok(near(w.non, 100 * 0.8 * 0.75, 1e-9), "피해 감소·약화 오류");
}

console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
