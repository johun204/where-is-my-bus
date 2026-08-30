const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** [ [lng,lat], ... ] → 누적거리 테이블 */
export function buildPath(coords) {
  const pts = coords.map(([lng, lat]) => ({ lat, lng }));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1] + haversine(pts[i - 1], pts[i]);
  }
  return { pts, cum, total: cum[cum.length - 1] || 0 };
}

const HINT_WINDOW_M = 800; // hintAlong 주변 이 범위를 우선 탐색
const HINT_ACCEPT_M = 80; // 그 범위 안에서 경로와 이만큼 이내면 채택

/**
 * target(위경도)을 경로에 투영 → { dist: 경로와의 거리(m), along: 경로상 누적거리(m) }.
 *
 * hintAlong 이 주어지면 그 주변 구간을 먼저 본다. 왕복이 같은 도로를 공유하는 노선에서
 * GPS 노이즈로 반대방향 구간에 투영돼 진행방향이 뒤집히는 것을 막기 위함.
 */
export function projectOnPath({ pts, cum }, target, hintAlong = null) {
  const scan = (lo, hi) => {
    let best = { dist: Infinity, along: 0 };
    for (let i = 0; i < pts.length - 1; i++) {
      if (cum[i + 1] < lo || cum[i] > hi) continue;
      const { t, p } = closestOnSeg(pts[i], pts[i + 1], target);
      const d = haversine(p, target);
      if (d < best.dist) best = { dist: d, along: cum[i] + t * (cum[i + 1] - cum[i]) };
    }
    return best;
  };

  if (hintAlong != null) {
    const near = scan(hintAlong - HINT_WINDOW_M, hintAlong + HINT_WINDOW_M);
    if (near.dist < HINT_ACCEPT_M) return near; // 연속성 유지 (같은 방향 차선에 고정)
  }
  return scan(-Infinity, Infinity); // 힌트 없음 / 창 안에 마땅한 구간 없음 → 전체 탐색
}

/** 경로상 누적거리 along(m) → { lat, lng, heading(도) } */
export function pointAtDistance({ pts, cum, total }, along) {
  along = Math.max(0, Math.min(total, along));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < along) i++;
  const a = pts[i - 1];
  const b = pts[i] ?? a;
  const segLen = cum[i] - cum[i - 1] || 1;
  const t = (along - cum[i - 1]) / segLen;
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
    heading: bearing(a, b),
  };
}

const DWELL_S = 5; // 지연보정 중 정류장 하나를 지나는 데 배정하는 시간(정차·가감속)
const STOP_EPS = 8; // 이 거리 안이면 그 정류장에 '있는' 것으로 간주

/**
 * refAlong 에서 leadSec 만큼 앞선 경로상 위치.
 * 앞에 정류장이 있으면 그 정류장에서 DWELL_S 만큼 시간을 소비(정차)한 것으로 쳐서
 * 지연보정이 정류장을 무작정 지나쳐 버리지 않게 한다.
 */
export function leadAlong(refAlong, speed, leadSec, stopAlongs, startIdx = 0) {
  if (speed < 0.6 || leadSec <= 0) return refAlong;
  let pos = refAlong;
  let remain = leadSec;
  let i = startIdx;
  while (i < stopAlongs.length && stopAlongs[i] < pos - STOP_EPS) i += 1;
  while (i < stopAlongs.length && remain > 0) {
    const gap = stopAlongs[i] - pos;
    if (gap > 0) {
      const t = gap / speed;
      if (t > remain) {
        pos += speed * remain; // 정류장에 못 미치고 리드 종료
        remain = 0;
        break;
      }
      pos = stopAlongs[i]; // 정류장 도달
      remain -= t;
    }
    remain -= DWELL_S; // 이 정류장에서 소요
    i += 1;
  }
  if (remain > 0) pos += speed * remain;
  return pos;
}

/** stopAlongs(오름차순)에서 along 이상인 첫 인덱스 */
export function sidxFor(stopAlongs, along) {
  let lo = 0;
  let hi = stopAlongs.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (stopAlongs[m] < along - STOP_EPS) lo = m + 1;
    else hi = m;
  }
  return lo;
}

// --- 내부 ---
function closestOnSeg(a, b, p) {
  // 짧은 구간이라 위도 보정한 평면 근사로 충분
  const kx = Math.cos(rad((a.lat + b.lat) / 2));
  const ax = a.lng * kx;
  const ay = a.lat;
  const bx = b.lng * kx;
  const by = b.lat;
  const px = p.lng * kx;
  const py = p.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-12;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { t, p: { lat: ay + dy * t, lng: (ax + dx * t) / kx } };
}

function bearing(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180) / Math.PI;
}
