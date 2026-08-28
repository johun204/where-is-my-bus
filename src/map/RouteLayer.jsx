import { useEffect, useState } from 'react';
import { drawRoute } from './drawRoute';
import { useBusMarkers } from './useBusMarkers';

/**
 * 즐겨찾기 노선 하나를 지도에 얹는다: 경로선 + 정류장 점 + 실시간 버스.
 * route: { routeId, routeNo, routeTp, cityCode }
 */
export function RouteLayer({ map, route }) {
  const [detail, setDetail] = useState(null); // { path, stops, routeTp }

  useEffect(() => {
    let on = true;
    fetch(`/api/route?routeId=${route.routeId}&cityCode=${route.cityCode ?? 25}`)
      .then((r) => r.json())
      .then((d) => {
        if (on) setDetail({ ...d, routeTp: route.routeTp });
      });
    return () => {
      on = false;
    };
  }, [route.routeId, route.cityCode, route.routeTp]);

  useEffect(() => {
    if (!map || !detail) return undefined;
    return drawRoute(map, detail); // 언마운트 시 정리
  }, [map, detail]);

  useBusMarkers(map, detail && { ...detail, routeId: route.routeId });

  return null;
}
