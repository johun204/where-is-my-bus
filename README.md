# where-is-my-bus — 내 버스는 어디쯤?

서울시 버스 노선·정류장·실시간 위치를 지도에 시각화하는 PWA.
Vercel(React + Python Serverless Functions) + 카카오맵, DB 없이 localStorage.

배포: https://where-is-my-bus-web.vercel.app
(지도 렌더링에는 카카오 콘솔 Web 플랫폼에 이 도메인 등록 필요)

## 구조

```
api/                    Vercel Python Serverless (서울시 버스 API 프록시 + 10초 캐시)
  _util.py              공통: ws.bus.go.kr 호출 + XML 파싱 + 캐시 + 응답 헬퍼
  bus-position.py       GET /api/bus-position?routeId=<busRouteId>     (실시간 위치, getBusPosByRtid)
  route.py              GET /api/route?routeNo=  또는  ?routeId=       (검색 getBusRouteList / 정류장 getStaionByRoute + 도로형상 getRoutePath)
src/
  App.jsx                      모바일 UI(상단 검색바 / 즐겨찾기 칩 / 현위치 FAB), 첫 진입 현위치 이동, PWA 설치버튼
  hooks/useFavoriteRoutes.js   즐겨찾기 노선 localStorage 영속화
  map/routeColor.js            노선유형 → 색상 (간선 파랑 / 지선 초록 / 광역 빨강 / 순환 노랑)
  map/busPath.js               경로 투영 + 경로를 따라가는 보간 계산
  map/busOverlay.js            버스 마커(노선색 SVG + 상단 노선번호), setScale로 축척 연동
  map/drawRoute.js             Polyline + 정류장 점마커
  map/useBusMarkers.js         폴링(접속직후 3s×3회 → 이후 10s) + 최근 3회 평균속도 추측항법(대기 중 전진, 응답 시 보정·재계산) + 줌 연동 스케일
  map/RouteLayer.jsx           노선 1개 = 경로 + 정류장 + 버스
public/                 manifest(standalone·maskable) / service worker(HTML 네트워크 우선) / 아이콘
```

## 사용하는 공공데이터포털 API

서울은 TAGO(국토부 전국) 도시코드에 포함되지 않아 **서울시 버스운행정보(TOPIS) 공유서비스**를 사용한다.
엔드포인트는 모두 `http://ws.bus.go.kr/api/rest`, 응답은 XML.

| 서비스 | 용도 | 오퍼레이션 |
|--------|------|-----------|
| [서울특별시_버스위치정보조회](https://www.data.go.kr/data/15000332/openapi.do) | 실시간 버스 위치 폴링 | `buspos/getBusPosByRtid` |
| 서울특별시_노선정보조회 | 노선 검색 + 경로(Polyline) · 정류장 좌표 | `busRouteInfo/getBusRouteList`, `busRouteInfo/getStaionByRoute` |

**두 서비스를 같은 인증키로 각각 "활용신청"** 해야 함(자동승인). 미신청 시
`유효하지 않은 서비스키입니다: 등록되지 않은 서비스키` (HTTP 401) 로 실패한다.

원 기획서의 TAGO API(15098533/15142030 등)는 서울 데이터가 없어 사용하지 않음.
`routeType`: 1 공항 / 2 마을 / 3 간선(파랑) / 4 지선(초록) / 5 순환(노랑) / 6 광역(빨강).

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
2. 환경변수 등록: `DATA_GO_KR_KEY`(공공데이터포털 인증키), `VITE_KAKAO_KEY`(카카오 JS 앱키)
3. 카카오 개발자 콘솔에 배포 도메인을 등록 (JS 키는 프론트에 노출됨)
4. Deploy

Python 함수는 표준 라이브러리만 사용하므로 `requirements.txt`가 없습니다.
