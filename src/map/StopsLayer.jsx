import { useEffect, useRef } from 'react';
import { haversine } from './busPath';
import { stopMarkerSvg } from './stopIcon';

const MAX_LEVEL = 4; // 이 레벨 이하(더 확대)에서만 정류장 마커 표시
const NAME_LEVEL = 3; // 정류장 이름은 이 레벨 이하에서만 (레벨4는 너무 많아 겹침)
const MAX_RADIUS = 1000; // getStationByPos 반경 상한(m)
const LABEL_OFF = 20; // 마커 중심 ~ 이름 라벨 중심 거리(px)

// 가장 가까운 다른 정류장 방향 ≈ 도로 방향. 그 수직으로(라벨이 노선과 안 겹치게) 라벨 배치.
function labelOffset(s, all) {
  let best = null;
  const kx = Math.cos((s.lat * Math.PI) / 180);
  for (const o of all) {
    if (o === s) continue;
    const dx = (o.lng - s.lng) * kx;
    const dy = o.lat - s.lat;
    const d2 = dx * dx + dy * dy;
    if (d2 > 0 && (!best || d2 < best.d2)) best = { d2, dx, dy };
  }
  if (!best) return { ox: 14, oy: -14 }; // 이웃 없음 → 우상단
  const len = Math.hypot(best.dx, best.dy) || 1;
  const rx = best.dx / len;
  const ry = -best.dy / len; // 화면좌표(y 아래) 기준 도로 방향
  // 수직 두 방향 중 화면에서 더 '위'(y 작은) 쪽 선택 → 라벨이 마커 위쪽에 오도록
  const a = { x: -ry, y: rx };
  const b = { x: ry, y: -rx };
  const p = a.y <= b.y ? a : b;
  return { ox: Math.round(p.x * LABEL_OFF), oy: Math.round(p.y * LABEL_OFF) };
}

/**
 * 현재 지도 화면에 보이는 영역의 모든 버스 정류장(마커 + 이름)을 표시.
 * (즐겨찾기 노선과 무관 — /api/stops = stationinfo/getStationByPos)
 * pickedArsId: 지금 선택한 정류장 — 어느 정류장을 기준으로 보고 있는지 지도에서 보이게.
 */
export function StopsLayer({ map, onStopClick, pickedArsId }) {
  const elsRef = useRef(new Map()); // arsId -> 마커 엘리먼트 (선택 표시 토글용)
  const pickRef = useRef(pickedArsId);
  pickRef.current = pickedArsId;

  // 새로 만들어지는 마커는 생성 시점에, 이미 있는 마커는 여기서 표시를 맞춘다
  useEffect(() => {
    for (const [id, el] of elsRef.current) {
      el.classList.toggle('stop-wrap--pick', id === pickedArsId);
    }
  }, [pickedArsId]);

  useEffect(() => {
    if (!map) return undefined;
    const { kakao } = window;
    const markers = new Map(); // arsId -> CustomOverlay
    const els = elsRef.current;
    let alive = true;
    let lastKey = '';
    let timer = 0;

    function clearAll() {
      for (const ov of markers.values()) ov.setMap(null);
      markers.clear();
      els.clear();
      lastKey = '';
    }

    function applyNameVisibility() {
      document.body.classList.toggle('hide-stop-names', map.getLevel() > NAME_LEVEL);
    }

    async function refresh() {
      if (!alive) return;
      applyNameVisibility();
      if (map.getLevel() > MAX_LEVEL) {
        clearAll();
        return;
      }
      const c = map.getCenter();
      const b = map.getBounds();
      if (!b || !c) return;
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      const r = Math.min(
        MAX_RADIUS,
        Math.round(
          haversine(
            { lat: sw.getLat(), lng: sw.getLng() },
            { lat: ne.getLat(), lng: ne.getLng() },
          ) / 2,
        ) + 60,
      );
      const key = `${c.getLat().toFixed(4)},${c.getLng().toFixed(4)},${r}`;
      if (key === lastKey) return;
      lastKey = key;

      let list;
      try {
        const res = await fetch(
          `/api/stops?lat=${c.getLat()}&lng=${c.getLng()}&radius=${r}`,
        );
        const d = await res.json();
        list = Array.isArray(d.stops) ? d.stops : null;
      } catch {
        return;
      }
      if (!alive || !list) return;

      const seen = new Set();
      for (const s of list) {
        seen.add(s.arsId);
        if (markers.has(s.arsId)) continue;

        const el = document.createElement('div');
        el.className = s.arsId === pickRef.current ? 'stop-wrap stop-wrap--pick' : 'stop-wrap';
        el.style.cursor = 'pointer';
        el.style.pointerEvents = 'auto';
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onStopClick(s);
        });

        const mk = document.createElement('div');
        mk.className = 'stop-marker';
        mk.innerHTML = stopMarkerSvg;

        const nm = document.createElement('div');
        nm.className = 'stop-name';
        nm.textContent = s.name || '';
        const { ox, oy } = labelOffset(s, list);
        nm.style.setProperty('--ox', `${ox}px`);
        nm.style.setProperty('--oy', `${oy}px`);

        el.append(mk, nm);
        els.set(s.arsId, el);
        markers.set(
          s.arsId,
          new kakao.maps.CustomOverlay({
            map,
            position: new kakao.maps.LatLng(s.lat, s.lng),
            content: el,
            xAnchor: 0.5,
            yAnchor: 0.5,
            zIndex: 6, // 버스 마커(5)보다 위 → 겹치면 정류장이 먼저 눌림
          }),
        );
      }
      for (const [id, ov] of markers) {
        if (!seen.has(id)) {
          ov.setMap(null);
          markers.delete(id);
          els.delete(id);
        }
      }
    }

    const onIdle = () => {
      applyNameVisibility();
      clearTimeout(timer);
      timer = setTimeout(refresh, 250);
    };
    kakao.maps.event.addListener(map, 'idle', onIdle);
    refresh();

    return () => {
      alive = false;
      clearTimeout(timer);
      kakao.maps.event.removeListener(map, 'idle', onIdle);
      document.body.classList.remove('hide-stop-names');
      clearAll();
    };
  }, [map, onStopClick]);

  return null;
}
