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

/** target(위경도)을 경로에 투영 → { dist: 경로와의 거리(m), along: 경로상 누적거리(m) } */
export function projectOnPath({ pts, cum }, target) {
  let best = { dist: Infinity, along: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const { t, p } = closestOnSeg(pts[i], pts[i + 1], target);
    const d = haversine(p, target);
    if (d < best.dist) best = { dist: d, along: cum[i] + t * (cum[i + 1] - cum[i]) };
  }
  return best;
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
