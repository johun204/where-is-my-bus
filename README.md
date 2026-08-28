# where-is-my-bus

서울시 버스 노선·정류장·실시간 위치를 지도에 시각화하는 PWA.
Vercel(React + Python Serverless Functions) + 카카오맵, DB 없이 localStorage.

## 구조

```
api/                    Vercel Python Serverless (공공데이터포털 프록시 + 10초 캐시)
  _util.py              공통: fetch + 캐시 + 응답 헬퍼
  bus-position.py       GET /api/bus-position?routeId=&cityCode=25   (실시간 위치, TAGO 15098533)
  route.py              GET /api/route?routeNo=  또는  ?routeId=      (노선검색 / 경유정류소, TAGO 15142030)
src/
  hooks/useFavoriteRoutes.js   즐겨찾기 노선 localStorage 영속화
  map/routeColor.js            노선유형 → 색상 (간선 파랑 / 지선 초록 / 광역 빨강 / 순환 노랑)
  map/busPath.js               경로 투영 + 경로를 따라가는 보간 계산
  map/busOverlay.js            색상 입힌 버스 마커(inline SVG CustomOverlay)
  map/drawRoute.js             Polyline + 정류장 점마커
  map/useBusMarkers.js         15초 폴링 + requestAnimationFrame 보간 애니메이션
  map/RouteLayer.jsx           노선 1개 = 경로 + 정류장 + 버스
public/                 manifest / service worker / 아이콘 (iOS '홈 화면에 추가' 지원)
```

## 사용하는 공공데이터포털 API

| 데이터 | 용도 |
|--------|------|
| 15098533 (TAGO) 버스위치정보 | 실시간 버스 위치 폴링 |
| 15142030 버스노선 (경유정류소/배차) | 노선 검색 + Polyline 경로 + 정류장 좌표 |

15096280(정류소정보)·15157601(초정밀 위치)은 미사용 — 정류장 좌표가 노선조회에 포함되고,
초정밀 API는 5,000콜/일 제한이라 즐겨찾기가 1~2개일 때 선택적으로만 붙일 것.

> `api/*.py`의 엔드포인트 경로·파라미터명은 발급받은 API 문서 기준으로 최종 확인하세요.

## 로컬 실행

```bash
npm install
cp .env.example .env      # DATA_GO_KR_KEY, VITE_KAKAO_KEY 채우기
npm run dev               # 프론트만. /api 까지 함께 띄우려면: npx vercel dev
```

`busPath.js` 자체 검증: `node src/map/busPath.test.mjs`

## Vercel 배포

1. 이 저장소를 Vercel에 Import (프레임워크: Vite 자동 감지)
2. 환경변수 등록: `DATA_GO_KR_KEY`(공공데이터포털 Decoding 인증키), `VITE_KAKAO_KEY`(카카오 JS 앱키)
3. 카카오 개발자 콘솔에 배포 도메인을 등록 (JS 키는 프론트에 노출됨)
4. Deploy

Python 함수는 표준 라이브러리만 사용하므로 `requirements.txt`가 없습니다.
