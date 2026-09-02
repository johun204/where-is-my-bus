import { useEffect } from 'react';
import { haversine } from './busPath';
import { stopMarkerSvg } from './stopIcon';

const MAX_LEVEL = 4; // 이 레벨 이하(더 확대)일 때만 전체 정류장 표시
const MAX_RADIUS = 1000; // getStationByPos 반경 상한(m)

/**
 * 현재 지도 화면에 보이는 영역의 모든 버스 정류장을 표시한다.
 * (즐겨찾기 노선과 무관 — /api/stops = stationinfo/getStationByPos)
 */
export function StopsLayer({ map, onStopClick }) {
  useEffect(() => {
    if (!map) return undefined;
    const { kakao } = window;
    const markers = new Map(); // arsId -> CustomOverlay
    let alive = true;
    let lastKey = '';
    let timer = 0;

    function clearAll() {
      for (const ov of markers.values()) ov.setMap(null);
      markers.clear();
      lastKey = '';
    }

    async function refresh() {
      if (!alive) return;
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
        el.className = 'stop-marker';
        el.innerHTML = stopMarkerSvg;
        el.style.cursor = 'pointer';
        el.style.pointerEvents = 'auto';
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onStopClick(s);
        });
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
        }
      }
    }

    const onIdle = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 250); // 팬/줌 정착 후
    };
    kakao.maps.event.addListener(map, 'idle', onIdle);
    refresh();

    return () => {
      alive = false;
      clearTimeout(timer);
      kakao.maps.event.removeListener(map, 'idle', onIdle);
      clearAll();
    };
  }, [map, onStopClick]);

  return null;
}
