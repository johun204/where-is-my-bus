import { routeTypeColor } from './routeColor';

// 정류장 마커: 살짝 둥근 정사각형 안에 버스 정면(앞유리 + 헤드라이트)
const stopSvg = (color) => `
<svg viewBox="0 0 20 20" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="18" height="18" rx="5" fill="${color}" stroke="#ffffff" stroke-width="1.6"/>
  <rect x="5" y="4.6" width="10" height="5.8" rx="1.6" fill="#ffffff"/>
  <circle cx="6.6" cy="13.8" r="1.35" fill="#ffffff"/>
  <circle cx="13.4" cy="13.8" r="1.35" fill="#ffffff"/>
</svg>`;

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
    el.className = 'stop-marker';
    el.innerHTML = stopSvg(color);
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
