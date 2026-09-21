import { useEffect, useRef } from 'react';
import { createBusOverlay } from './busOverlay';
import {
  buildPath,
  haversine,
  pointAtDistance,
  projectOnPath,
  projectStopsAlong,
  sidxFor,
} from './busPath';
import { V_STOP, predict } from './predict';
import { routeTypeColor } from './routeColor';

const FAST_MS = 3000; // 접속 직후: 이 간격으로
const FAST_COUNT = 3; // 이만큼 fetch 해서 최근속도를 빨리 확보
const SLOW_MS = 6000; // 이후 통상 폴링 주기
const TRACK_MS = 3000; // 추적 중인 노선은 계속 빠르게 (오차가 가장 중요한 순간)
const LEAD_FALLBACK_MS = 7000; // dataTm 없거나 기기 시계 어긋날 때 기본 지연 추정치
const WINDOW = 3; // 최근속도 계산에 쓰는 fix 개수
const SNAP_M = 120; // 도로형상에서 이만큼 벗어난 좌표는 스냅
const JUMP_M = 3000; // 경로상 이만큼 튀면(순환노선 한 바퀴 등) 스냅
const MAX_SPEED = 18; // m/s (~65km/h)
const ARRIVE_SNAP_M = 150; // stopFlag=1 일 때 해당 정류장으로 당기는 최대 거리

const VSHOW_TAU = 0.6; // s 표시속도 평활
const CORR_TAU = 0.9; // s 위치오차 보정 시간상수 (짧을수록 빨리 따라잡음)
const CORR_MAX = 10; // m/s 위치오차 보정 상한(표시속도에 더해지는 최대)
const INITIAL_SPEED = 5; // m/s 새 버스의 초기 속도 추정(첫 fix 라 실측 속도 없음)
const RESTORE_MAX_MS = 25000; // 새로고침 복원: 저장상태가 이보다 오래되면 무시

const STAT_MS = 1000; // 추적 중 카드 정보 갱신 주기
const ETA_MIN_V = 3.5; // m/s ETA 계산에 쓰는 하한 속도(정차 중엔 실측이 0 이라 무한대가 됨)
const ETA_DWELL_S = 12; // s ETA 에서 정류장 하나당 더하는 시간
const MISS_LIMIT = 3; // 추적 차량이 연속 이만큼 안 보이면 운행종료로 판단
const SAME_FIX_MS = 1000; // 실측 시각이 이 안이면 같은 fix 의 재전송으로 본다

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// dataTm(KST yyyyMMddHHmmss) → 이 fix 가 얼마나 지난 것인지(ms). 시계 어긋나면 기본값.
function fixLagMs(dataTm) {
  if (!/^\d{14}$/.test(dataTm || '')) return LEAD_FALLBACK_MS;
  const s = dataTm;
  const epoch = Date.UTC(
    +s.slice(0, 4),
    +s.slice(4, 6) - 1,
    +s.slice(6, 8),
    +s.slice(8, 10) - 9, // KST → UTC
    +s.slice(10, 12),
    +s.slice(12, 14),
  );
  const lag = Date.now() - epoch;
  return lag >= 0 && lag < 45000 ? lag : LEAD_FALLBACK_MS;
}

function zoomScale(level) {
  return clamp(1.4 ** (4 - level), 0.45, 2.4);
}

// sectOrd + sectDist/fullSectDist(구간 진행률) 로 낸 경로상 위치. GPS 투영보다 안정적.
function sectAlong(b, stopAlongs) {
  const so = b.sectOrd;
  if (!Number.isFinite(so) || so < 1 || so >= stopAlongs.length) return null;
  const start = stopAlongs[so - 1];
  const end = stopAlongs[so];
  if (start == null || end == null || end <= start) return null;
  let f = 0.5;
  if (
    Number.isFinite(b.sectDist) &&
    Number.isFinite(b.fullSectDist) &&
    b.fullSectDist > 0
  ) {
    f = clamp(b.sectDist / b.fullSectDist, 0, 1);
  }
  return start + f * (end - start);
}

/**
 * 노선 하나의 실시간 버스 마커를 그리고 위치를 보정한다.
 *
 * opts:
 *   onBusClick(info)      마커 탭
 *   onAutoTrack(info)     autoTrack 요청에 대한 응답(추적할 차량을 골라서 알려줌)
 *   onTrackStat(info)     추적 중 1초마다 최신 정보
 *   onTrackLost()         추적 차량이 응답에서 사라짐(운행 종료)
 *   trackedVehicleNo      추적 중인 차량번호
 *   selectedVehicleNo     팝업이 열려 있는 차량번호
 *   trackCentering        false 면 추적 중이어도 지도를 따라 옮기지 않음
 *   refStop               { arsId, name } 사용자가 탭한 기준 정류장 (없으면 null)
 *   autoTrack             true 면 이 노선에서 추적할 버스를 골라 onAutoTrack 호출
 */
export function useBusMarkers(map, route, opts = {}) {
  const busesRef = useRef(new Map());
  const optRef = useRef(opts);
  optRef.current = opts; // 콜백/프롭은 항상 최신 것을 effect 안에서 참조

  useEffect(() => {
    if (!map || !route?.path?.length) return undefined;

    const { kakao } = window;
    const path = buildPath(route.path);
    const color = routeTypeColor(route.routeTp);
    const buses = busesRef.current;
    const stops = route.stops || [];

    // 정류장의 경로상 위치. 순번 제약을 쓰는 단조 투영이라 결과가 곧 오름차순이고,
    // sectAlong(순번 기준)·leadAlong/sidxFor(오름차순 기준) 양쪽에 그대로 쓸 수 있다.
    const nStops = stops.length;
    const stopAlongs = projectStopsAlong(path, stops);

    // 새로고침 복원: 직전 세션이 예측하던 위치·속도를 sessionStorage 에서 되살림.
    // (없으면 새 버스는 INITIAL_SPEED 로 시드 → 첫 프레임부터 지연분만큼 앞서 표시)
    const SS_KEY = `busmarkers.${route.routeId}`;
    const restored = new Map();
    try {
      const raw = JSON.parse(sessionStorage.getItem(SS_KEY) || 'null');
      if (raw && Date.now() - raw.t < RESTORE_MAX_MS) {
        const age = (Date.now() - raw.t) / 1000;
        for (const k in raw.b) {
          const [sp, al] = raw.b[k];
          restored.set(k, { speed: sp, along: al + sp * age }); // 저장 후 흐른 시간만큼 전진
        }
      }
    } catch {
      /* 무시 */
    }

    let alive = true;
    let raf = 0;
    let lastFrame = performance.now();
    let scale = zoomScale(map.getLevel());
    let lastTrackCenter = 0;
    let lastStat = 0;
    let missCount = 0;
    let autoServed = false;

    // 기준 정류장의 경로상 위치(이 노선에 없으면 null)
    function refStopAlong(refStop) {
      if (!refStop?.arsId) return null;
      const i = stops.findIndex((s) => s.arsId === refStop.arsId);
      return i < 0 ? null : stopAlongs[i];
    }

    // 기준 정류장(사용자가 탭한 정류장)까지 몇 정거장·몇 분 남았는지.
    // 기준이 없으면 null — GPS 최근접으로 추측하지 않는다(방향이 반대인 건너편
    // 정류장을 집어서 엉뚱한 거리가 나오던 원인).
    function destFor(st, refStop) {
      if (!refStop?.arsId) return null;
      // 순환노선은 같은 정류장이 두 번 나올 수 있다 → 버스 앞쪽 첫 번째 것
      let idx = -1;
      for (let i = 0; i < nStops; i++) {
        if (stops[i].arsId !== refStop.arsId) continue;
        if (idx < 0) idx = i;
        if (stopAlongs[i] >= st.along - 30) {
          idx = i;
          break;
        }
      }
      if (idx < 0) return { name: refStop.name, notOnRoute: true };

      const name = stops[idx].name || refStop.name;
      const gap = stopAlongs[idx] - st.along;
      if (gap < -30) return { name, passed: true };
      const here = gap < 30; // 사실상 그 정류장에 와 있음
      const away = Math.max(1, sidxFor(stopAlongs, stopAlongs[idx]) - sidxFor(stopAlongs, st.along) + 1);
      return {
        name,
        stopsAway: here ? 0 : away,
        meters: Math.max(0, Math.round(gap)),
        etaSec: Math.round(
          Math.max(0, gap) / Math.max(st.speed, ETA_MIN_V) + (here ? 0 : away - 1) * ETA_DWELL_S,
        ),
      };
    }

    // 카드/팝업에 쓰는 정보 한 덩어리 (마커 탭 시·추적 중 1초마다 같은 형태)
    function infoFor(vno, st) {
      const b = st.gps || {};
      const p = pointAtDistance(path, st.along);
      const dest = destFor(st, optRef.current.refStop);

      // 이 노선 기준 다음 정류장까지 — 내 위치와 무관하다.
      // 정차 중이면 실측 속도가 0 이라 ETA 가 무한대가 되므로 하한 속도를 쓴다.
      const ni = stops.findIndex((s) => s.ord === (b.sectOrd || 0) + 1);
      const nextGap = ni >= 0 ? Math.max(0, stopAlongs[ni] - st.along) : null;

      return {
        routeId: route.routeId,
        routeNo: route.routeNo,
        routeTp: route.routeTp,
        vehicleNo: vno,
        lowFloor: b.lowFloor,
        congestion: b.congestion,
        stopFlag: b.stopFlag,
        dataTm: b.dataTm,
        nextStopName: ni >= 0 ? stops[ni].name : null,
        nextStopMeters: nextGap == null ? null : Math.round(nextGap),
        nextStopSec:
          nextGap == null ? null : Math.round(nextGap / Math.max(st.speed, ETA_MIN_V)),
        moving: st.speed >= V_STOP && b.stopFlag !== 1,
        speedKmh: Math.round(st.speed * 3.6),
        lat: p.lat,
        lng: p.lng,
        dest,
      };
    }

    const onZoom = () => {
      scale = zoomScale(map.getLevel());
      for (const st of buses.values()) st.overlay.setScale(scale);
    };
    kakao.maps.event.addListener(map, 'zoom_changed', onZoom);

    function frame(now) {
      if (!alive) return;
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;
      const nowWall = Date.now();
      const kShow = 1 - Math.exp(-dt / VSHOW_TAU);
      const o = optRef.current;
      const trackVno = o.trackedVehicleNo || null;

      for (const [vno, st] of buses) {
        const { pDes, vEst } = predict(st, nowWall, stopAlongs);
        const pD = clamp(pDes, 0, path.total);

        st.vShown += (vEst - st.vShown) * kShow;
        if (st.vShown < 0) st.vShown = 0;

        const gap = pD - st.along;
        if (gap > 0) {
          const corr = Math.min(gap / CORR_TAU, CORR_MAX);
          st.along = Math.min(st.along + (st.vShown + corr) * dt, pD); // 앞으로만, 목표 안 넘김
        }
        // 절대 규칙: 마지막 실측 위치(a0)보다 뒤에 있으면 안 됨 (몇 초 늦는 건 치명적)
        if (st.along < st.refAlong) st.along = st.refAlong;
        st.along = clamp(st.along, 0, path.total);

        const p = pointAtDistance(path, st.along);
        const ll = new kakao.maps.LatLng(p.lat, p.lng);
        st.overlay.setPosition(ll);
        st.overlay.setHeading(p.heading);

        const active = vno === trackVno || vno === o.selectedVehicleNo;
        if (active !== st.active) {
          st.active = active;
          st.overlay.setActive(active);
        }
        if (vno === trackVno && o.trackCentering !== false && now - lastTrackCenter > 80) {
          map.setCenter(ll);
          lastTrackCenter = now;
        }
      }

      // 노선 칩 탭 → 내 정류장으로 오고 있는(아직 안 지난) 가장 가까운 버스를 고른다
      if (!o.autoTrack) {
        autoServed = false;
      } else if (!autoServed && buses.size) {
        autoServed = true;
        let best = null;
        const refAlong = refStopAlong(o.refStop);
        if (refAlong != null) {
          for (const [vno, st] of buses) {
            if (st.along <= refAlong - 10 && (!best || st.along > best.along)) {
              best = { vno, along: st.along };
            }
          }
        }
        if (!best) {
          const c = map.getCenter();
          const cp = { lat: c.getLat(), lng: c.getLng() };
          for (const [vno, st] of buses) {
            const d = haversine(pointAtDistance(path, st.along), cp);
            if (!best || d < best.d) best = { vno, d };
          }
        }
        if (best) o.onAutoTrack?.(infoFor(best.vno, buses.get(best.vno)));
      }

      if (trackVno && now - lastStat > STAT_MS) {
        lastStat = now;
        const st = buses.get(trackVno);
        if (st) o.onTrackStat?.(infoFor(trackVno, st));
      }

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // 최근 WINDOW개 fix 의 구간속도를 최근일수록 크게 가중평균 (fix 시각 기준)
    function recalcSpeed(st) {
      const s = st.samples;
      if (s.length < 2) {
        st.speed = 0;
        return;
      }
      let wsum = 0;
      let vsum = 0;
      for (let i = 1; i < s.length; i++) {
        const d = (s[i].t - s[i - 1].t) / 1000;
        if (d <= 0) continue;
        const v = clamp((s[i].along - s[i - 1].along) / d, 0, MAX_SPEED);
        wsum += i;
        vsum += i * v;
      }
      st.speed = wsum > 0 ? vsum / wsum : 0;
    }

    async function poll() {
      let data;
      try {
        const res = await fetch(`/api/bus-position?routeId=${route.routeId}`);
        data = await res.json();
      } catch {
        return;
      }
      if (!alive) return;
      if (!Array.isArray(data.buses)) return;

      const nowWall = Date.now();
      const seen = new Set();

      for (const b of data.buses) {
        seen.add(b.vehicleNo);
        const st = buses.get(b.vehicleNo);

        const aSect = sectAlong(b, stopAlongs); // sectOrd + 구간진행률 기반 위치
        let hint = st ? st.refAlong : aSect;
        if (hint == null && Number.isFinite(b.sectOrd) && nStops > 1) {
          hint = path.total * clamp(b.sectOrd / nStops, 0, 1);
        }
        const proj = projectOnPath(path, b, hint);
        // 기준위치 a0: GPS 투영(raw) 과 sectOrd 진행률 위치를 블렌드해 노이즈 감소하되,
        // raw GPS 위치보다 뒤로는 절대 잡지 않는다(뒤처지면 치명적).
        // 둘이 크게 어긋나면(왕복 공유구간 GPS 오투영) 방향이 확실한 sectOrd 채택.
        let a0 = proj.along;
        if (aSect != null) {
          a0 =
            Math.abs(aSect - proj.along) > 400
              ? aSect
              : Math.max(proj.along, proj.along * 0.6 + aSect * 0.4);
        }
        // 정류장 도착 상태면 그 정류장 위치로 스냅. 사용자가 정확도를 가장 원하는 순간이라
        // GPS 노이즈 대신 "정류장에 서 있다"는 API 의 사실을 그대로 쓴다.
        if (b.stopFlag === 1) {
          const at = stopAlongs[b.sectOrd];
          if (Number.isFinite(at) && Math.abs(at - a0) < ARRIVE_SNAP_M) a0 = at;
        }

        const fixWall = nowWall - fixLagMs(b.dataTm); // 이 실측의 시각(추정)
        const sidx = sidxFor(stopAlongs, a0);

        if (!st) {
          // 실측 속도가 아직 없으므로: 복원값 있으면 그걸로, 없으면 도시버스 평균 시드.
          // refAlong 은 raw a0 유지(뒤로 안 감 보장) — along 만 앞서 출발시킨다.
          const rs = restored.get(b.vehicleNo);
          const seedSpeed = b.stopFlag === 1 ? 0 : rs ? rs.speed : INITIAL_SPEED;
          const seedAlong = Math.max(a0, rs ? rs.along : a0);
          const p0 = pointAtDistance(path, seedAlong);
          const vno = b.vehicleNo;
          const overlay = createBusOverlay(
            map,
            new kakao.maps.LatLng(p0.lat, p0.lng),
            color,
            route.routeNo,
            scale,
            () => {
              const cur = buses.get(vno);
              if (cur) optRef.current.onBusClick?.(infoFor(vno, cur));
            },
          );
          buses.set(vno, {
            overlay,
            along: seedAlong,
            vShown: 0,
            speed: seedSpeed,
            refAlong: a0,
            fixWall,
            haltWall: b.stopFlag === 1 ? fixWall : null,
            sidx,
            stopFlag: b.stopFlag,
            active: false,
            gps: b,
            samples: [{ along: a0, t: fixWall }],
          });
          continue;
        }

        const lastS = st.samples[st.samples.length - 1];
        // 폴링 주기가 API 갱신 주기보다 짧아서 같은 fix 가 다시 오는 경우가 잦다.
        // 그걸 샘플로 넣으면 Δt=0 인 구간 때문에 속도가 0으로 무너져 '정차'로 오판한다.
        const sameFix = Math.abs(fixWall - lastS.t) < SAME_FIX_MS;
        if (sameFix) {
          st.gps = b;
          st.fixWall = fixWall;
          continue;
        }
        if (proj.dist > SNAP_M || Math.abs(a0 - lastS.along) > JUMP_M) {
          // 순환노선 한 바퀴(끝→처음)면 그대로, 그 외(경로 이탈 등)는 앞으로만
          const loopWrap = st.along > path.total * 0.75 && a0 < path.total * 0.25;
          st.along = loopWrap ? a0 : Math.max(st.along, a0);
          st.vShown = 0;
          st.speed = INITIAL_SPEED; // 실측 연속성 끊김 — 멈춘 걸로 오인하지 않게 평균속도로
          st.samples = [{ along: a0, t: fixWall }];
        } else {
          st.samples.push({ along: a0, t: fixWall });
          if (st.samples.length > WINDOW) st.samples.shift();
          recalcSpeed(st);
        }

        // 멈춤 구간의 시작 시각 — "이미 얼마나 서 있었나"가 출발 시점 예측의 핵심 단서
        const halted = b.stopFlag === 1 || st.speed < V_STOP;
        st.haltWall = halted ? (st.haltWall ?? fixWall) : null;

        st.refAlong = a0;
        if (st.along < a0) st.along = a0; // 새 실측이 마커보다 앞 → 즉시 당김(뒤엔 절대 안 둠)
        st.fixWall = fixWall;
        st.sidx = sidx;
        st.stopFlag = b.stopFlag;
        st.gps = b;
        if (b.vehicleNo === optRef.current.selectedVehicleNo) {
          optRef.current.onBusClick?.(infoFor(b.vehicleNo, st));
        }
      }

      for (const [vno, st] of buses) {
        if (!seen.has(vno)) {
          st.overlay.remove();
          buses.delete(vno);
        }
      }

      // 추적하던 차량이 연속으로 안 보이면 운행 종료/차고지행 → 위로 알림
      const tv = optRef.current.trackedVehicleNo;
      if (tv) {
        if (seen.has(tv)) {
          missCount = 0;
        } else {
          missCount += 1;
          if (missCount >= MISS_LIMIT) {
            missCount = 0;
            optRef.current.onTrackLost?.();
          }
        }
      }

      // 새로고침 대비 스냅샷 (예측 위치·속도)
      try {
        const snap = {};
        for (const [vno, st] of buses) {
          snap[vno] = [Math.round(st.speed * 10) / 10, Math.round(st.along)];
        }
        sessionStorage.setItem(SS_KEY, JSON.stringify({ t: Date.now(), b: snap }));
      } catch {
        /* 무시 */
      }
    }

    let pollCount = 0;
    let timer = 0;
    async function loop() {
      await poll();
      if (!alive) return;
      pollCount += 1;
      const wait = optRef.current.trackedVehicleNo
        ? TRACK_MS
        : pollCount < FAST_COUNT
          ? FAST_MS
          : SLOW_MS;
      timer = setTimeout(loop, wait);
    }
    loop();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      kakao.maps.event.removeListener(map, 'zoom_changed', onZoom);
      for (const st of buses.values()) st.overlay.remove();
      buses.clear();
    };
  }, [map, route?.routeId]); // eslint-disable-line react-hooks/exhaustive-deps
}
