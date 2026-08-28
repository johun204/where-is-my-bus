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
| [15098533](https://www.data.go.kr/data/15098533/openapi.do) (TAGO) 버스위치정보 `BusLcInfoInqireService` | 실시간 버스 위치 폴링 |
| [15098529](https://www.data.go.kr/data/15098529/openapi.do) (TAGO) 버스노선정보 `BusRouteInfoInqireService` | 노선 검색(`getRouteNoList`) + Polyline 경로 · 정류장 좌표(`getRouteAcctoThrghSttnList`) |

**두 API 모두 같은 인증키로 각각 "활용신청"** 해야 함(자동승인). 하나만 신청하면 다른 쪽은
`SERVICE_KEY_IS_NOT_REGISTERED_ERROR(30)` 로 실패한다.

원 기획서의 15142030(버스노선)은 노선ID·번호 등 기초 정적자료 위주라 실시간용으로 부적합해
같은 1613000 네임스페이스의 15098529 로 대체함. 15096280(정류소정보)·15157601(초정밀 위치)은
미사용 — 정류장 좌표가 노선조회에 포함되고, 초정밀 API는 5,000콜/일 제한이 있음.

## 로컬 실행

```bash
npm install
cp .env.example .env      # DATA_GO_KR_KEY, VITE_KAKAO_KEY 채우기

python api/_local.py      # 터미널 1: /api 서버 (:8000). .env 자동 로드
npm run dev               # 터미널 2: 프론트 (:5173). /api 는 :8000 으로 프록시
```

- 카카오 개발자 콘솔 Web 플랫폼 사이트 도메인에 `http://localhost:5173` 등록 필요.
- `vercel dev` 는 Vercel 로그인이 필요하므로 로컬은 위 2-프로세스 방식을 사용.

`busPath.js` 자체 검증: `node src/map/busPath.test.mjs`

## Vercel 배포

1. 이 저장소를 Vercel에 Import (프레임워크: Vite 자동 감지)
2. 환경변수 등록: `DATA_GO_KR_KEY`(공공데이터포털 Decoding 인증키), `VITE_KAKAO_KEY`(카카오 JS 앱키)
3. 카카오 개발자 콘솔에 배포 도메인을 등록 (JS 키는 프론트에 노출됨)
4. Deploy

Python 함수는 표준 라이브러리만 사용하므로 `requirements.txt`가 없습니다.
