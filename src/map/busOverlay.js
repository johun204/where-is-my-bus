// 아이콘의 '위'가 진행방향. useBusMarkers 가 heading(도)만큼 회전시킨다.
const busSvg = (color) => `
<svg viewBox="0 0 30 30" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
  <g stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round">
    <path d="M15 1 L22 9 L8 9 Z" fill="${color}"/>
    <rect x="7" y="8" width="16" height="20" rx="4" fill="${color}"/>
    <rect x="10" y="11.5" width="10" height="5" rx="1.2" fill="#ffffff" stroke="none" opacity="0.95"/>
  </g>
</svg>`;

/**
 * 버스 마커: 노선색 방향표시 아이콘 + 상단 노선번호 라벨.
 *  setPosition(latlng)  위치 이동
 *  setHeading(deg)      진행방향으로 아이콘만 회전 (멈춰 있어도 항상 방향 표시)
 *  setScale(k)          지도 축척에 맞춰 아이콘·번호 함께 확대축소
 */
export function createBusOverlay(map, latlng, color, routeNo, scale = 1) {
  const { kakao } = window;

  const wrap = document.createElement('div');
  wrap.className = 'bus-ovl';
  wrap.style.transform = `scale(${scale})`;

  const label = document.createElement('div');
  label.className = 'bus-ovl__no';
  label.textContent = routeNo ?? '';

  const icon = document.createElement('div');
  icon.className = 'bus-ovl__icon';
  icon.innerHTML = busSvg(color);

  wrap.append(label, icon);

  const overlay = new kakao.maps.CustomOverlay({
    map,
    position: latlng,
    content: wrap,
    xAnchor: 0.5,
    yAnchor: 0.5,
    zIndex: 5,
  });

  return {
    setPosition: (ll) => overlay.setPosition(ll),
    setHeading: (deg) => {
      icon.style.transform = `rotate(${deg}deg)`;
    },
    setScale: (k) => {
      wrap.style.transform = `scale(${k})`;
    },
    remove: () => overlay.setMap(null),
  };
}
