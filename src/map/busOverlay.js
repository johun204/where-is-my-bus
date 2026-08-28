const busSvg = (color) => `
<svg width="32" height="32" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <g fill="${color}" stroke="#fff" stroke-width="1.2" stroke-linejoin="round">
    <rect x="4" y="2.5" width="16" height="16" rx="3"/>
    <rect x="6" y="5.5" width="12" height="5" rx="1" fill="#ffffff" opacity="0.9" stroke="none"/>
    <circle cx="8" cy="20" r="2"/><circle cx="16" cy="20" r="2"/>
  </g>
</svg>`;

/**
 * 노선 색상이 입혀진 버스 마커(CustomOverlay) 생성.
 * MarkerImage는 색 변경이 안 되므로 inline SVG를 DOM으로 붙인다.
 */
export function createBusOverlay(map, latlng, color) {
  const { kakao } = window;
  const wrap = document.createElement('div');
  wrap.style.cssText = 'width:32px;height:32px;will-change:transform';
  wrap.innerHTML = busSvg(color);

  const svg = wrap.firstElementChild;
  svg.style.cssText = 'transform-origin:50% 50%;transition:transform .35s linear';

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
      svg.style.transform = `rotate(${deg}deg)`;
    },
    remove: () => overlay.setMap(null),
  };
}
