// 정류장까지 걸어가는 시간과, 그래서 다음 버스를 탈 수 있을지의 확률.
// (순수 함수 — catchBus.test.mjs 로 검증)

// 정류장까지 직선으로 걸어갈 수 있는 길은 없다. 블록을 돌고 횡단보도를 기다리므로
// 직선거리에 우회 보정계수를 곱한다. (현장 보정 노브)
export const WALK_DETOUR = 1.35;
export const WALK_DEFAULT_V = 1.25; // m/s 성인 평균 보행속도 — 멈춰 있을 때의 가정치

// s 도보·버스 양쪽 불확실성의 크기. 여유가 이만큼이면 약 73% 로 본다.
const CATCH_SIGMA = 45;

/** 직선거리(m) + 실측 보행속도(m/s, 없으면 평균 보폭) → 정류장 도착까지 걸리는 초 */
export function walkSeconds(meters, speed) {
  if (!Number.isFinite(meters) || meters < 0) return null;
  const v = Number.isFinite(speed) && speed > 0.3 ? speed : WALK_DEFAULT_V;
  return Math.round((meters * WALK_DETOUR) / v);
}

/**
 * 버스가 busSec 뒤 도착, 나는 walkSec 뒤 도착 → 그 버스를 탈 확률(0~1).
 * 여유(busSec - walkSec)가 0이면 50%, 여유가 커질수록 1에 수렴하는 로지스틱.
 * 버스 도착예정도 내 도보시간도 오차가 크므로 계단함수로 단정하지 않는다.
 */
export function catchProb(busSec, walkSec) {
  if (!Number.isFinite(busSec) || !Number.isFinite(walkSec)) return null;
  return 1 / (1 + Math.exp(-(busSec - walkSec) / CATCH_SIGMA));
}
