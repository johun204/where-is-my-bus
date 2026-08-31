import { routeTypeColor } from './routeColor';

/**
 * 노선 선(Polyline) + 정류장 점마커를 그린다.
 * 반환 함수를 호출하면 모두 제거.
 */
export function drawRoute(map, route, onStopClick) {
  const { kakao } = window;
  const path = Array.isArray(route?.path) ? route.path : [];
  const stops = Array.isArray(route?.stops) ? route.stops : [];
  if (!path.length) return () => {};

  const color = routeTypeColor(route.routeTp);

  const polyline = new kakao.maps.Polyline({
    path: path.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng)),
    strokeWeight: 4,
    strokeColor: color,
    strokeOpacity: 0.85,
  });
  polyline.setMap(map);

  const dots = stops.map((s) => {
    const el = document.createElement('div');
    el.className = 'stop-dot';
    el.style.background = color;
    if (onStopClick && s.arsId && s.arsId !== '0') {
      el.style.cursor = 'pointer';
      el.style.pointerEvents = 'auto';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onStopClick(s);
      });
    }
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
