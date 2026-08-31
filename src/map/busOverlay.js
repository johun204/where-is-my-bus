// 아이콘의 '위'가 진행방향. useBusMarkers 가 heading(도)만큼 회전시킨다.
// 앞쪽(위)이 살짝 좁은 캡슐 + 앞유리 → 화살표 없이도 방향이 읽힘.
const busSvg = (color) => `
<svg viewBox="0 0 30 30" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
  <path d="M15 3c4.6 0 6.5 2.6 6.5 6.4v14c0 2.6-1.7 3.9-6.5 3.9s-6.5-1.3-6.5-3.9v-14C8.5 5.6 10.4 3 15 3z"
        fill="${color}" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>
  <rect x="10" y="8.5" width="10" height="4.6" rx="2" fill="#ffffff"/>
</svg>`;

const innerTransform = (k) => `translate(-50%, -50%) scale(${k})`;

/**
 * 버스 마커.
 * Kakao 에는 0×0 앵커 div 만 넘겨서 좌표에 그 점을 고정하고(축척과 무관),
 * 실제 보이는 부분은 그 위에서 translate(-50%,-50%) 로 중심을 맞춘 뒤 scale 한다.
 * → 지도를 축소해도 아이콘 중심이 항상 노선 라인 위에 위치.
 *
 *  setPosition(latlng)  위치 이동
 *  setHeading(deg)      진행방향으로 아이콘만 회전 (멈춰 있어도 항상 표시)
 *  setScale(k)          지도 축척에 맞춰 아이콘·번호 함께 확대축소
 */
export function createBusOverlay(map, latlng, color, routeNo, scale = 1, onClick) {
  const { kakao } = window;

  const anchor = document.createElement('div');
  anchor.className = 'bus-anchor';

  const inner = document.createElement('div');
  inner.className = 'bus-ovl';
  inner.style.transform = innerTransform(scale);
  if (onClick) {
    inner.style.cursor = 'pointer';
    inner.style.pointerEvents = 'auto';
    inner.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
  }

  const label = document.createElement('div');
  label.className = 'bus-ovl__no';
  label.textContent = routeNo ?? '';

  const icon = document.createElement('div');
  icon.className = 'bus-ovl__icon';
  icon.innerHTML = busSvg(color);

  inner.append(label, icon);
  anchor.append(inner);

  const overlay = new kakao.maps.CustomOverlay({
    map,
    position: latlng,
    content: anchor,
    xAnchor: 0,
    yAnchor: 0,
    zIndex: 5,
  });

  return {
    setPosition: (ll) => overlay.setPosition(ll),
    setHeading: (deg) => {
      icon.style.transform = `rotate(${deg}deg)`;
    },
    setScale: (k) => {
      inner.style.transform = innerTransform(k);
    },
    remove: () => overlay.setMap(null),
  };
}
