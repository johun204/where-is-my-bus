// 현위치 마커: 파란 점 + (추적 모드에서) 바라보는 방향으로 퍼지는 손전등 빛 모양 콘.
// buses 와 같은 0×0 앵커 패턴이라 축척을 바꿔도 위치가 어긋나지 않음.
const CONTENT = `
<svg class="myloc-cone" width="150" height="150" viewBox="-75 -75 150 150"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="mylocBeam" cx="50%" cy="100%" r="100%">
      <stop offset="0%" stop-color="#1a73e8" stop-opacity="0.5"/>
      <stop offset="55%" stop-color="#1a73e8" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#1a73e8" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <path d="M0 0 L-46 -60 A75 75 0 0 1 46 -60 Z" fill="url(#mylocBeam)"/>
</svg>
<div class="myloc-dot"></div>`;

export function createMyLocation(map, latlng) {
  const { kakao } = window;

  const anchor = document.createElement('div');
  anchor.className = 'myloc-anchor';
  anchor.innerHTML = CONTENT;
  const cone = anchor.querySelector('.myloc-cone');
  cone.style.display = 'none';

  const overlay = new kakao.maps.CustomOverlay({
    map,
    position: latlng,
    content: anchor,
    xAnchor: 0,
    yAnchor: 0,
    zIndex: 8,
  });

  return {
    setPosition: (ll) => overlay.setPosition(ll),
    setHeading: (deg) => {
      if (deg == null || Number.isNaN(deg)) {
        cone.style.display = 'none';
        return;
      }
      cone.style.display = '';
      cone.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
    },
    remove: () => overlay.setMap(null),
  };
}
