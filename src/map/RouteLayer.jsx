import { useEffect, useRef, useState } from 'react';
import { drawRoute } from './drawRoute';
import { useBusMarkers } from './useBusMarkers';

/**
 * 즐겨찾기 노선 하나를 지도에 얹는다: 경로선 + 실시간 버스.
 * route: { routeId, routeNo, routeTp }
 * bus: useBusMarkers 로 그대로 넘기는 옵션 묶음 (추적/선택/기준 정류장 등)
 * onStops(routeId, arsIds): 이 노선이 서는 정류장 목록 — "이 정류장 노선만 보기" 판정용
 */
export function RouteLayer({ map, route, bus, onStops }) {
  const [detail, setDetail] = useState(null); // { path, stops, routeTp }
  const onStopsRef = useRef(onStops);
  onStopsRef.current = onStops;

  useEffect(() => {
    let on = true;
    fetch(`/api/route?routeId=${route.routeId}`)
      .then((r) => r.json())
      .then((d) => {
        // API 오류 시 { error, detail } 가 오므로 형태 검증 후에만 반영
        if (on && Array.isArray(d.path) && Array.isArray(d.stops)) {
          setDetail({ ...d, routeTp: route.routeTp });
          onStopsRef.current?.(route.routeId, d.stops.map((s) => s.arsId));
        }
      })
      .catch(() => {}); // 일시적 네트워크 오류는 무시 (다음 마운트에서 복구)
    return () => {
      on = false;
    };
  }, [route.routeId, route.routeTp]);

  useEffect(() => {
    if (!map || !detail) return undefined;
    return drawRoute(map, detail); // 언마운트 시 정리
  }, [map, detail]);

  useBusMarkers(
    map,
    detail && { ...detail, routeId: route.routeId, routeNo: route.routeNo },
    bus,
  );

  return null;
}
