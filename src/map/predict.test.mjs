// predict.js 자체 검증 — 프레임워크 없이: node src/map/predict.test.mjs
import assert from 'node:assert';
import { MAX_EXTRAP_S, predict } from './predict.js';

const T = 1_700_000_000_000; // 기준 wall time
const base = { refAlong: 1000, fixWall: T, speed: 8, stopFlag: 0, haltWall: null, sidx: 0 };
const noStops = [];

// ── ③ 주행 중: 경과시간 × 속도만큼 앞으로 (전방편향 때문에 약간 더)
{
  const { pDes, vEst } = predict(base, T + 6000, noStops);
  assert.ok(pDes > 1000 + 8 * 6, `주행 중 전진: ${pDes}`);
  assert.ok(pDes < 1000 + 8 * 6 + 40, `과도한 전진 아님: ${pDes}`);
  assert.strictEqual(vEst, 8);
}

// 실측 직후(경과 0)라도 전방편향만큼은 앞선다 — 뒤처짐이 더 치명적이므로
assert.ok(predict(base, T, noStops).pDes > 1000, '경과 0 에서도 뒤는 아님');

// 아무리 오래 응답이 없어도 MAX_EXTRAP_S 를 넘겨 추정하지 않음
{
  const far = predict(base, T + 600_000, noStops).pDes;
  assert.ok(far < 1000 + 8 * (MAX_EXTRAP_S + 5) * 1.7, `무한 전진 방지: ${far}`);
}

// 앞에 정류장이 있으면 그 자리에서 잠깐 지체 → 훌쩍 지나치지 않음
{
  const free = predict(base, T + 10_000, noStops).pDes;
  const withStop = predict(base, T + 10_000, [1030]).pDes;
  assert.ok(withStop < free, `정류장 지체 반영: ${withStop} < ${free}`);
  assert.ok(withStop >= 1030, `정류장까지는 도달: ${withStop}`);
}

// ── ① 정류장 정차: 방금 도착했으면 제자리
{
  const st = { ...base, speed: 0.2, stopFlag: 1, haltWall: T };
  const now = predict(st, T + 4000, noStops);
  assert.strictEqual(now.pDes, 1000, '막 도착한 버스는 제자리');
  assert.strictEqual(now.vEst, 0);
}

// 이미 오래 서 있던 버스는 실측 직후부터 곧 출발한 것으로 본다
{
  const st = { ...base, speed: 0.2, stopFlag: 1, haltWall: T - 30_000 };
  assert.strictEqual(predict(st, T + 1000, noStops).pDes, 1000, '최소 대기는 지킴');
  const moved = predict(st, T + 10_000, noStops);
  assert.ok(moved.pDes > 1000, `오래 정차 → 출발 가정: ${moved.pDes}`);
  assert.ok(moved.vEst > 0);
}

// ── ② 신호/정체: 정류장 정차보다 더 오래 기다린 뒤 출발 가정
{
  const stop = { ...base, speed: 0.2, stopFlag: 1, haltWall: T };
  const signal = { ...base, speed: 0.2, stopFlag: 0, haltWall: T };
  const t = T + 16_000;
  assert.ok(
    predict(stop, t, noStops).pDes > predict(signal, t, noStops).pDes,
    '같은 시간 경과면 정류장이 신호보다 먼저 출발',
  );
}

// ── 불변식: 어떤 경우에도 마지막 실측 위치보다 뒤로 가지 않는다
for (const flag of [0, 1]) {
  for (const speed of [0, 0.5, 3, 12]) {
    for (const dt of [0, 1000, 7000, 25_000, 120_000]) {
      const st = { ...base, speed, stopFlag: flag, haltWall: flag || speed < 0.8 ? T : null };
      const { pDes } = predict(st, T + dt, [1050, 1400]);
      assert.ok(pDes >= 1000, `뒤로 감 flag=${flag} v=${speed} dt=${dt} → ${pDes}`);
    }
  }
}

console.log('predict.js OK');
