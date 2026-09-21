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
  arrivals.py           GET /api/arrivals?arsId=<ARS>                  (정류장 도착예정, stationinfo/getStationByUid — 서울시_정류소정보조회 서비스 15000303 활용신청 필요)
src/
  App.jsx                      화면 전체: 상단 검색·노선칩, 하단 정보카드(핵심 정보는 엄지 영역), 두 손가락 지도 회전, 추적 상태 영속화
  map/predict.js               ★ 위치 보정 모델(순수함수) — 정차/신호/주행 3케이스 + 전방편향. predict.test.mjs 로 검증
  map/busPath.js               경로 투영(단조 정류장 투영 projectStopsAlong 포함) + 보간(leadAlong)
  map/useBusMarkers.js         폴링·속도추정·보정 적용·마커 애니메이션·추적/자동선택/도착정보 산출
  map/useMyLocation.js         watchPosition 연속 추적 + 추적 모드(지도 팔로우 + 나침반 방위로 지도 12시 정렬), 현위치 좌표 제공
  map/busOverlay.js            버스 마커(노선색 SVG + 노선번호), setScale 축척 연동, setActive 추적 강조
  map/StopsLayer.jsx           화면에 보이는 정류장 마커 + 이름 라벨 (탭하면 도착정보)
  map/RouteLayer.jsx           노선 1개 = 경로선 + 버스
  map/drawRoute.js             Polyline
  map/routeColor.js            노선유형 → 색상 (간선 파랑 / 지선 초록 / 광역 빨강 / 순환 노랑)
  hooks/useFavoriteRoutes.js   즐겨찾기 노선 localStorage 영속화
public/                 manifest(standalone·maskable) / service worker(HTML 네트워크 우선) / 아이콘
```

## 위치 보정 (predict.js)

API 는 `dataTm` 기준 몇 초 전 데이터이고 폴링 간격도 있어서, 받은 좌표를 그대로 찍으면
화면의 버스가 **항상 실제보다 뒤에** 있다. 사용자는 "지금 뛰면 탈 수 있나"를 보므로
뒤처지는 쪽이 앞서는 쪽보다 훨씬 치명적 → 불확실하면 앞으로 치우치게 잡는다.

| 상태 | 판정 | 보정 |
|------|------|------|
| 정류장 정차 (`stopFlag=1`) | 위치를 그 정류장 좌표로 스냅 | 표준 승하차시간(11s) 전엔 제자리, 지나면 출발 가정 |
| 정차인데 도착 아님 | 신호·횡단보도·정체 | 표준 대기(20s) 기준으로 동일 처리 |
| 주행 중 | 최근 3회 실측 평균속도 | 도로형상을 따라 추측항법 + 앞 정류장에서 잠깐 지체 |

①②의 핵심은 **"이미 얼마나 서 있었는지"**(`haltWall`)다. 방금 선 버스는 더 기다리지만
20초째 서 있던 버스는 곧 출발하므로 `남은 대기 = 표준시간 - 이미 선 시간` 으로 잡는다.
평균속도는 정차시간이 섞인 실효속도라, `busPath.DWELL_S` 는 표준 승하차시간보다 작게(3.5s) 둔다.

보정 노브(현장에서 조정): `predict.js` 의 `BIAS_S`(전방편향) · `DWELL_TYPICAL` · `SIGNAL_TYPICAL` ·
`RESUME_V`, `busPath.js` 의 `DWELL_S`.

정류장의 경로상 위치(`projectStopsAlong`)는 **순번 제약을 쓰는 단조 투영**이다.
왕복이 같은 도로를 공유하면 가는/오는 차선이 수십 m 차이라 순수 최근접으로는 구분이 안 되고,
정류장 간격이 균등하다고 가정한 힌트 투영은 반대방향 구간에 붙어 along 이 수 km 튀었다
(→ "22정거장 전 8794m" 버그). 이 값은 `sectAlong`(버스 위치의 주 근거)의 기반이기도 하다.

불변식: 마커는 **마지막 실측 위치보다 절대 뒤로 가지 않는다**(`useBusMarkers` 의 `st.along < st.refAlong` 가드).

## 조작

- 상단 검색 → 노선 추가 → 노선 **칩을 탭하면** 그 노선에서 나에게 오고 있는
  가장 가까운 버스를 자동으로 골라 추적한다(`autoTrack`). 칩의 `×` 는 삭제.
- 버스 마커 탭 → 하단 카드 → `이 버스 추적하기`.
- **"N정거장 전"의 기준은 지도에서 탭한 정류장**(`busmap.refstop.v1`). 현위치로 추측하지 않는다 —
  GPS 최근접은 길 건너 반대방향 정류장을 집어서 엉뚱한 거리를 냈다. 기준을 정하기 전에는
  카드가 안내 문구만 보여준다.
- 지도를 직접 움직이면 따라가기만 멈추고(추적은 유지) `버스로 이동` 으로 되돌아간다.
- 추적 상태는 localStorage(`busmap.track.v1`, 6시간) 에 차량번호·마지막 좌표까지 저장 →
  **앱을 껐다 켜면 그 버스 위치에서 바로 시작**한다. 그 차량이 운행을 마쳤으면 안내 후 해제.

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

자체 검증(프레임워크 없음): `node src/map/busPath.test.mjs` · `node src/map/predict.test.mjs` · `python api/_util_test.py`

## Vercel 배포

1. 이 저장소를 Vercel에 Import (프레임워크: Vite 자동 감지)
2. 환경변수 등록: `DATA_GO_KR_KEY`(공공데이터포털 인증키), `VITE_KAKAO_KEY`(카카오 JS 앱키)
3. 카카오 개발자 콘솔에 배포 도메인을 등록 (JS 키는 프론트에 노출됨)
4. Deploy

Python 함수는 표준 라이브러리만 사용하므로 `requirements.txt`가 없습니다.
