// 전체 정류장 통일 색상 (밝은 파란색)
export const STOP_COLOR = '#3da0ee';

// 살짝 둥근 정사각형 안에 버스 정면(앞유리 + 헤드라이트)
export const stopMarkerSvg = `
<svg viewBox="0 0 20 20" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="18" height="18" rx="5" fill="${STOP_COLOR}" stroke="#ffffff" stroke-width="1.6"/>
  <rect x="5" y="4.6" width="10" height="5.8" rx="1.6" fill="#ffffff"/>
  <circle cx="6.6" cy="13.8" r="1.35" fill="#ffffff"/>
  <circle cx="13.4" cy="13.8" r="1.35" fill="#ffffff"/>
</svg>`;
