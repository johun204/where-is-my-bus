const busSvg = (color) => `
<svg viewBox="0 0 24 24" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
  <g fill="${color}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round">
    <rect x="4" y="2.5" width="16" height="16" rx="3"/>
    <rect x="6" y="5.5" width="12" height="5" rx="1" fill="#ffffff" opacity="0.9" stroke="none"/>
    <circle cx="8" cy="20" r="2"/><circle cx="16" cy="20" r="2"/>
  </g>
</svg>`;

/**
 * 버스 마커: 노선색 아이콘 + 상단 노선번호 라벨.
 *  setPosition(latlng)  위치 이동
 *  setHeading(deg)      진행방향으로 아이콘만 회전
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
