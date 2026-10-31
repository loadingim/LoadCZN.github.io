/*
 * CZN 길잡이 · 피해량 계산 코어
 * 화면(index.html)과 검증 스크립트(tools/test-calc.js)가 같은 계산식을 쓰도록 계산만 따로 모았다.
 * 브라우저에서는 window.CZNCalc, Node에서는 require("./js/calc-core.js") 로 불러온다.
 * 각 단계의 근거·검증 상태와 실측 사례는 data/formula.json 에 정리되어 있다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CZNCalc = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  const pct = v => num(v) / 100;

  // 게임 화면의 피해량 계수 표시: 소수점 첫째 자리에서 올림 (3011.25% → 3012%, 2598.75% → 2599%)
  // 부동소수 오차(예: 226.60000000000002)를 먼저 정리한 뒤 올린다.
  const ceilShow = n => Math.ceil(Math.round(n * 1e4) / 1e4);
  // 실제 피해 숫자의 정수 처리 방식은 확인되지 않아 반올림으로 표시한다 (formula.json 참고).
  const roundShow = n => Math.round(Math.round(n * 1e4) / 1e4);

  const ATK_CONST = 0.35;        // Prydwen Damage Formula의 상수 (실측 검증 안 됨)
  const DEF_ATK_RATE = 0.3;      // 방어 기반 피해: (공격력 × 0.3 + 방어력 × 2.1) — Prydwen, 실측 검증 안 됨
  const DEF_DEF_RATE = 2.1;
  const WEAKEN_MUL = 0.75;       // 약화(공격자) — Prydwen 설명, 실측 검증 안 됨

  /* 1) 공격력 --------------------------------------------------------------------
   * 실제 공격력 = {N × (1 + A) × (1 + B) + C} × (1 + D) × (1 + G) × (1 + X)
   *   N: 전투원 기본 공격력 + 파트너 공격력 + 기억의 조각 깡공
   *   A: 장비·파트너 공격력% (혼돈의 지적, 혼세의 촉수, 노래하는 검, 파트너 패시브) — 그룹 안은 합
   *   B: 기억의 조각 공격력% (세트·주옵션·부옵션) — 그룹 안은 합
   *   C: 무기 기본 공격력 (5단계 강화: 희귀 74 · 전설 82 · 신화 90)
   *   D: 심록 장신구(낮·밤·굴레), G: 숲의 클로버 — 전투 중 버프, 각각 최종 곱
   *   X: 위치가 확인되지 않은 전투 중 공격력 버프 (따로 곱한다고 가정)
   * 스테이터스(캐릭터 화면) 공격력 = N × (1 + A) × (1 + B) + C 이므로, 스테이터스 값을 넣으면 N을 거꾸로 구한다.
   */
  function attack(p) {
    p = p || {};
    const A = pct(p.a), B = pct(p.b), C = num(p.c), D = pct(p.d), G = pct(p.g), X = pct(p.x);
    const useStatus = num(p.status) > 0;
    const N = useStatus
      ? Math.max(0, num(p.status) - C) / ((1 + A) * (1 + B))
      : num(p.base) + num(p.partner) + num(p.flat);
    const status = N * (1 + A) * (1 + B) + C;
    const final = status * (1 + D) * (1 + G) * (1 + X);
    return { N, A, B, C, D, G, X, status, final, fromStatus: useStatus };
  }

  /* 2) 카드 배율 ------------------------------------------------------------------
   * 카드 기본 배율 = (카드 피해 % + 잠재력 가산 %p) × (1 + 잠재력 강화 %)
   *   잠재력 강화: 기본·중립·고유 카드 강화 (레벨당 2%)
   *   잠재력 가산: '기본 카드 숙련'처럼 카드 피해량을 +n% 하는 노드
   */
  function cardBase(base, potAdd, potMul) {
    return (num(base) + num(potAdd)) * (1 + pct(potMul));
  }

  /* 3) 피해량 계수 ----------------------------------------------------------------
   * 핸드 계수 = 카드 기본 배율 × (1 + Σ'피해량 n% 증가') + Σ'피해량 +n%'
   * 핸드 표시 = 핸드 계수 × 최종 피해 (게임 카드에 뜨는 값)
   * 대상 계수 = (핸드 계수 + Σ'대상이 받는 피해량 +n%') × Π(1 + 받는 피해 곱연산) × 약점 × 최종 피해 × (1 − 피해 감소) × 약화
   * 치명 배율 = 1 + (치명피해 − 100%) × 증폭   (화면의 치명피해는 기본 100%를 포함한 값)
   * 기대 계수 = 대상 계수 × (1 + 치명확률 × (치명 배율 − 1))
   *
   * s: { base, potAdd, potMul, M(Σ n% 증가), A(Σ +n%), E(Σ 받는 피해 +n%), V(받는 피해 곱 배율),
   *      fin(최종 피해 배율), weak(약점 배율, 1이면 없음), dr(피해 감소 %), weaken(true/false), cr, cd, amp }
   */
  function critMul(cd, amp) {
    const a = amp === undefined || amp === null || amp === "" ? 1 : num(amp);
    return Math.max(1, 1 + (num(cd) / 100 - 1) * a);
  }
  function coefficient(s) {
    s = s || {};
    const base = cardBase(s.base, s.potAdd, s.potMul);
    const mulPart = base * (1 + pct(s.M));
    const hand = mulPart + num(s.A);
    const pre = hand + num(s.E);
    const V = s.V === undefined ? 1 : num(s.V);
    const weak = s.weak === undefined || s.weak === null ? 1 : num(s.weak);
    const fin = s.fin === undefined ? 1 : num(s.fin);
    const drMul = Math.max(0, 1 - pct(s.dr));
    const weakenMul = s.weaken ? WEAKEN_MUL : 1;
    // 핸드 표시(카드에 뜨는 값)는 최종 피해량까지 곱한 값이다. 받는 피해·약점은 적 위에 올렸을 때만 들어간다.
    // (로스바이세 명멸검 실측 2026-10-31: 2356 × 3.0 × 1.8 = 12722.4 → 12723%)
    const show = hand * fin;
    const non = pre * V * weak * fin * drMul * weakenMul;
    const C = critMul(s.cd, s.amp);
    const cr = Math.min(1, Math.max(0, pct(s.cr)));
    const crit = non * C;
    const exp = non * (1 + cr * (C - 1));
    return { base, mulPart, hand, show, pre, V, weak, fin, drMul, weakenMul, non, C, cr, crit, exp };
  }

  /* 4) 최종 피해 (추정) -------------------------------------------------------------
   * 공격력 기반: 계수 × 최종 공격력 × 0.35 × (1 + 속성 피해량) × (1 + 추가·지속 피해량) × 적 방어 계수
   * 방어 기반:   계수 × (최종 공격력 × 0.3 + 방어력 × 2.1) × 0.35 × …  (Prydwen)
   * 0.35·0.3·2.1과 적 방어 계수는 실측으로 확인되지 않았다. 속성·추가 피해량의 곱연산 위치는 커뮤니티 실측과 일치한다.
   */
  function damage(coefPct, d) {
    d = d || {};
    const atk = num(d.atk);
    const basis = d.defBased ? atk * DEF_ATK_RATE + num(d.def) * DEF_DEF_RATE : atk;
    const k = d.k === undefined ? ATK_CONST : num(d.k);
    const defMul = d.defMul === undefined || d.defMul === null || d.defMul === "" ? 1 : num(d.defMul);
    return num(coefPct) / 100 * basis * k * (1 + pct(d.el)) * (1 + pct(d.mech)) * defMul;
  }

  /* 한 번에 계산: 화면과 검증 사례가 같은 함수를 쓴다 */
  function evaluate(input) {
    const i = input || {};
    const atk = attack(i.atk || {});
    const coef = coefficient(i);
    const dmgOpt = { atk: atk.final, def: i.def, defBased: i.defBased, el: i.el, mech: i.mech, defMul: i.defMul, k: i.k };
    return {
      atk, coef,
      dmg: {
        non: damage(coef.non, dmgOpt),
        crit: damage(coef.crit, dmgOpt),
        exp: damage(coef.exp, dmgOpt)
      }
    };
  }

  return { attack, cardBase, coefficient, critMul, damage, evaluate, ceilShow, roundShow, ATK_CONST, DEF_ATK_RATE, DEF_DEF_RATE, WEAKEN_MUL };
});
