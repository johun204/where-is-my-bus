// busPath.js 자체 검증 — 프레임워크 없이 node로 실행: node src/map/busPath.test.mjs
import assert from 'node:assert';
import { buildPath, haversine, pointAtDistance, projectOnPath } from './busPath.js';

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

console.log('busPath.js OK');
