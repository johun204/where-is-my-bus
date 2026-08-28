// 서울 버스 유형별 색상
const C = {
  blue: '#3D5BAB', // 간선
  green: '#53B332', // 지선
  red: '#E60012', // 광역
  yellow: '#F7B32B', // 순환
  sky: '#48BEE8', // 공항 / 마을 / 기타
};

/**
 * routeTp: 숫자 코드 또는 한글 라벨('간선버스' 등) 둘 다 대응.
 * ⚠️ 숫자 코드값은 발급 API 응답으로 최종 확인할 것.
 */
export function routeTypeColor(routeTp) {
  const s = String(routeTp ?? '');
  if (/간선|^3$/.test(s)) return C.blue;
  if (/지선|^4$/.test(s)) return C.green;
  if (/광역|^6$/.test(s)) return C.red;
  if (/순환|^5$/.test(s)) return C.yellow;
  return C.sky; // 공항(1) / 마을(2) / 그 외
}
