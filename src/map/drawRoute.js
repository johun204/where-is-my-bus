import { routeTypeColor } from './routeColor';

/**
 * 노선 선(Polyline) + 정류장 점마커를 그린다.
 * 반환 함수를 호출하면 모두 제거.
 */
export function drawRoute(map, route) {
  const { kakao } = window;
  const path = Array.isArray(route?.path) ? route.path : [];
  const stops = Array.isArray(route?.stops) ? route.stops : [];
  if (!path.length) return () => {};

  const color = routeTypeColor(route.routeTp);

  const polyline = new kakao.maps.Polyline({
    path: path.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng)),
    strokeWeight: 5,
    strokeColor: color,
    strokeOpacity: 0.85,
  });
  polyline.setMap(map);

  const dots = stops.map((s) => {
    const el = document.createElement('div');
    el.style.cssText =
      `width:8px;height:8px;border-radius:50%;background:${color};` +
      'border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,.4)';
    const ov = new kakao.maps.CustomOverlay({
      map,
      position: new kakao.maps.LatLng(s.lat, s.lng),
      content: el,
      xAnchor: 0.5,
      yAnchor: 0.5,
      zIndex: 3,
    });
    return ov;
  });

  return () => {
    polyline.setMap(null);
    dots.forEach((d) => d.setMap(null));
  };
}
