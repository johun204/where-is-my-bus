import { routeTypeColor } from './routeColor';

/**
 * 노선 선(Polyline)만 그린다. 정류장 마커는 StopsLayer(화면 영역 전체)가 담당.
 * 반환 함수를 호출하면 제거.
 */
export function drawRoute(map, route) {
  const { kakao } = window;
  const path = Array.isArray(route?.path) ? route.path : [];
  if (!path.length) return () => {};

  const polyline = new kakao.maps.Polyline({
    path: path.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng)),
    strokeWeight: 4,
    strokeColor: routeTypeColor(route.routeTp),
    strokeOpacity: 0.85,
  });
  polyline.setMap(map);

  return () => polyline.setMap(null);
}
