// catchBus.js 자체 검증 — node src/map/catchBus.test.mjs
import assert from 'node:assert';
import { WALK_DEFAULT_V, WALK_DETOUR, catchProb, walkSeconds } from './catchBus.js';

// 직선 100m 를 평균 보폭으로 → 우회 보정만큼 직선보다 오래 걸린다
{
  const t = walkSeconds(100, null);
  assert.strictEqual(t, Math.round((100 * WALK_DETOUR) / WALK_DEFAULT_V));
  assert.ok(t > 100 / WALK_DEFAULT_V, '우회 보정이 반영됨');
}

// 빨리 걷는 중이면 더 짧다
assert.ok(walkSeconds(300, 2.0) < walkSeconds(300, null), '실측 보행속도 반영');

// 멈춰 있음(속도 0 또는 null)은 평균 보폭으로 동일 처리
assert.strictEqual(walkSeconds(300, 0), walkSeconds(300, null));
assert.strictEqual(walkSeconds(300, null), walkSeconds(300, undefined));

// 입력이 없으면 null
assert.strictEqual(walkSeconds(null, 1.3), null);
assert.strictEqual(walkSeconds(-5, 1.3), null);

// 버스와 내가 동시 도착이면 반반
assert.ok(Math.abs(catchProb(120, 120) - 0.5) < 1e-9, '여유 0 → 50%');

// 여유가 클수록 확률이 오르고, 0~1 을 벗어나지 않으며 단조다
let prev = 0;
for (const margin of [-600, -120, -45, 0, 45, 120, 600]) {
  const p = catchProb(300 + margin, 300);
  assert.ok(p > 0 && p < 1, `확률 범위: ${p}`);
  assert.ok(p > prev, `여유가 클수록 증가: ${margin} → ${p}`);
  prev = p;
}
assert.ok(catchProb(300, 60) > 0.99, '한참 여유 → 거의 확실');
assert.ok(catchProb(60, 300) < 0.01, '이미 늦음 → 거의 불가');

assert.strictEqual(catchProb(null, 100), null);
assert.strictEqual(catchProb(100, null), null);

console.log('catchBus.js OK');
