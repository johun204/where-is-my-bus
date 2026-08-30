// busPath.js 자체 검증 — 프레임워크 없이 node로 실행: node src/map/busPath.test.mjs
import assert from 'node:assert';
import {
  buildPath,
  haversine,
  leadAlong,
  pointAtDistance,
  projectOnPath,
  sidxFor,
} from './busPath.js';

// 대략 동서로 뻗은 3점 경로 (서울 시청 부근)
const path = buildPath([
  [126.9770, 37.5665],
  [126.9870, 37.5665],
  [126.9970, 37.5665],
]);

// total 은 두 구간 haversine 합과 일치
const seg =
  haversine({ lat: 37.5665, lng: 126.977 }, { lat: 37.5665, lng: 126.987 }) +
  haversine({ lat: 37.5665, lng: 126.987 }, { lat: 37.5665, lng: 126.997 });
assert.ok(Math.abs(path.total - seg) < 1, 'total distance');

// 경로 살짝 위(북쪽)로 벗어난 점 → 투영하면 along 은 중간쯤, dist 는 수십 m
const proj = projectOnPath(path, { lat: 37.5670, lng: 126.987 });
assert.ok(proj.dist > 30 && proj.dist < 80, `dist off-path: ${proj.dist}`);
assert.ok(
  Math.abs(proj.along - path.total / 2) < 5,
  `along at midpoint: ${proj.along}`,
);

// along = total/2 → 위치는 가운데 점, heading 은 동쪽(약 90도)
const mid = pointAtDistance(path, path.total / 2);
assert.ok(Math.abs(mid.lng - 126.987) < 1e-4, `mid lng: ${mid.lng}`);
assert.ok(Math.abs(mid.heading - 90) < 1, `mid heading: ${mid.heading}`);

// 범위 밖 along 은 끝점으로 clamp
assert.ok(Math.abs(pointAtDistance(path, 1e9).lng - 126.997) < 1e-4, 'clamp end');

// 왕복이 같은 도로를 공유하는 노선: 동쪽으로 갔다가 (약 5m 북쪽 차선으로) 되돌아옴
const loop = buildPath([
  [0, 0],
  [0.05, 0], // 동쪽 끝 (~5.5km)
  [0.05, 0.00005],
  [0, 0.00005], // 되돌아옴 (반대방향)
]);
const half = loop.cum[1]; // 반환점까지 거리
// 되돌아오는 차선 쪽에 더 가까운 노이즈 지점
const amb = { lat: 0.00004, lng: 0.025 };
// 힌트 없으면 더 가까운 '복귀' 구간으로 투영됨 (along > 반환점)
assert.ok(projectOnPath(loop, amb).along > half, 'no hint → picks return leg');
// 힌트(가는 방향 위치)를 주면 '가는' 구간에 고정
const hinted = projectOnPath(loop, amb, half / 2);
assert.ok(hinted.along < half, `hint → stays on outbound leg: ${hinted.along}`);

// leadAlong: 정류장 없는 구간은 그냥 speed*t
const noStops = [];
assert.strictEqual(leadAlong(100, 10, 6, noStops), 160, 'no stops → linear');
// 정류장이 리드 구간 안(150m 지점)에 있으면 거기서 DWELL(5s) 만큼 시간 소진 →
// speed 10, lead 10s: 5s 만에 150 도달, 남은 5s 중 5s 는 정차 → 정류장 부근에 머묾
const near = leadAlong(100, 10, 10, [150]);
assert.ok(near >= 150 && near <= 156, `dwell caps at stop: ${near}`);
// 정류장 한참 뒤(리드로 도달 불가)면 정류장 무시
assert.strictEqual(leadAlong(100, 10, 3, [500]), 130, 'far stop ignored');
// speed 거의 0 이면 그대로
assert.strictEqual(leadAlong(100, 0.2, 10, [150]), 100, 'stopped bus stays');

// sidxFor: 오름차순 배열에서 along 이상 첫 인덱스
assert.strictEqual(sidxFor([0, 100, 200, 300], 150), 2, 'sidx mid');
assert.strictEqual(sidxFor([0, 100, 200], 0), 0, 'sidx start');
assert.strictEqual(sidxFor([0, 100, 200], 999), 3, 'sidx past end');

console.log('busPath.js OK');
