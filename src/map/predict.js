// 준실시간 버스 위치 보정 모델 (순수 함수 — predict.test.mjs 로 검증).
//
// 서울시 API 응답은 dataTm 기준 몇 초 전 데이터이고 폴링 간격도 있어서,
// 받은 좌표를 그대로 찍으면 화면의 버스가 실제보다 항상 뒤에 있다.
// 사용자는 "지금 뛰면 탈 수 있나"를 판단하므로 **뒤에 그리는 쪽이 훨씬 치명적** →
// 불확실할 때는 앞쪽으로 치우치게 잡는다(BIAS_S).
//
// 케이스를 셋으로 나눈다.
//   ① 정류장 정차(stopFlag=1)  : 승하차 표준시간이 지나기 전엔 그 자리, 지나면 출발 가정
//   ② 정차인데 도착 아님       : 신호/횡단보도/정체 — 신호 표준시간 기준으로 같은 처리
//   ③ 주행 중                  : 도로형상을 따라 추측항법(앞 정류장에서 잠깐 지체)
//
// ①②의 핵심은 "이미 얼마나 서 있었는지(haltWall)"다. 방금 선 버스는 더 기다리지만
// 20초째 서 있던 버스는 곧 출발하므로, 남은 대기 = 표준시간 - 이미 선 시간.
import { leadAlong } from './busPath.js'; // node 로 테스트 실행 가능하게 확장자 명시

export const V_STOP = 0.8; // m/s 이 미만이면 멈춘 것으로 본다
export const MAX_EXTRAP_S = 30; // s 실측 이후 이 시간까지만 예측 전진 (그 이상은 못 믿음)

const DWELL_TYPICAL = 11; // s 정류장 승하차 표준 시간
const SIGNAL_TYPICAL = 20; // s 신호·횡단보도·정체 표준 대기
const MIN_REMAIN = 2; // s 아무리 오래 서 있었어도 최소 이만큼은 더 선다고 본다
const RESUME_V = 4.5; // m/s 다시 출발한 직후 가정 속도
const BIAS_S = 1.5; // s 전방 편향 — 뒤처짐 방지용 보정 노브(현장에서 조정)

/**
 * 지금 이 순간의 버스 위치를 추정한다.
 *
 * st: {
 *   refAlong  마지막 실측의 경로상 위치(m)
 *   fixWall   그 실측의 시각(ms, Date.now 기준 — dataTm 으로 역산)
 *   speed     최근 실측들로 낸 평균속도(m/s, 정차시간 포함된 실효속도)
 *   stopFlag  1이면 정류장 도착/정차
 *   haltWall  현재 멈춤 구간의 첫 실측 시각(ms). 주행 중이면 null
 *   sidx      refAlong 앞쪽 첫 정류장 인덱스
 * }
 * @returns {{ pDes:number, vEst:number }} 추정 위치(경로상 m)와 추정 속도(m/s)
 */
export function predict(st, nowWall, stopAlongs) {
  const a0 = st.refAlong;
  const el = Math.max(0, Math.min((nowWall - st.fixWall) / 1000, MAX_EXTRAP_S));

  if (st.stopFlag === 1 || st.speed < V_STOP) {
    const typical = st.stopFlag === 1 ? DWELL_TYPICAL : SIGNAL_TYPICAL;
    const already = st.haltWall != null ? (st.fixWall - st.haltWall) / 1000 : 0;
    const remain = Math.max(MIN_REMAIN, typical - already); // 실측 이후 더 설 시간
    const moveT = el - remain;
    if (moveT <= 0) return { pDes: a0, vEst: 0 };
    const v = Math.max(st.speed, RESUME_V);
    return { pDes: a0 + v * moveT, vEst: v };
  }

  // 주행 중: 실효속도 × 경과시간. 단 앞 정류장에서 잠깐 지체하는 것으로 쳐서
  // 사용자가 서 있는 정류장을 마커가 훌쩍 지나쳐 버리지 않게 한다.
  const lead = el + BIAS_S;
  const upper = a0 + Math.max(st.speed, 3) * lead * 1.6 + 25; // 폭주 방지 상한
  return {
    pDes: Math.min(leadAlong(a0, st.speed, lead, stopAlongs, st.sidx || 0), upper),
    vEst: st.speed,
  };
}
