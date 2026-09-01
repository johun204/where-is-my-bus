import { useEffect, useRef } from 'react';
import { createBusOverlay } from './busOverlay';
import { buildPath, leadAlong, pointAtDistance, projectOnPath, sidxFor } from './busPath';
import { routeTypeColor } from './routeColor';

const FAST_MS = 3000; // 접속 직후: 이 간격으로
const FAST_COUNT = 3; // 이만큼 fetch 해서 최근속도를 빨리 확보
const SLOW_MS = 6000; // 이후 통상 폴링 주기
const MAX_EXTRAP_S = 30; // 실측 이후 최대 이 시간까지만 예측 전진
const LEAD_FALLBACK_MS = 7000; // dataTm 없거나 기기 시계 어긋날 때 기본 지연 추정치
const WINDOW = 3; // 최근속도 계산에 쓰는 fix 개수
const SNAP_M = 120; // 도로형상에서 이만큼 벗어난 좌표는 스냅
const JUMP_M = 3000; // 경로상 이만큼 튀면(순환노선 한 바퀴 등) 스냅
const MAX_SPEED = 18; // m/s (~65km/h)

const V_STOP = 0.8; // 최근속도 이 미만이면 '정차'
const CONFIRM_HOLD_S = 9; // 마지막 폴이 이 안이면 '정차' 관측을 신뢰해 그 자리 고정
const DWELL_TYPICAL = 10; // 정류장 승하차 표준 시간(초)
const SIGNAL_TYPICAL = 18; // 신호대기 표준 시간(초)
const SIGNAL_RESUME_V = 4; // m/s 신호 풀린 뒤 가정 속도
const DEPART_V = 4; // m/s 정류장 출발 가정 속도
const VSHOW_TAU = 0.6; // s 표시속도 평활
const CORR_TAU = 1.2; // s 위치오차 보정 시간상수
const CORR_MAX = 7; // m/s 위치오차 보정 상한(표시속도에 더해지는 최대)

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
function sectAlong(b, stopByOrd) {
  const so = b.sectOrd;
  if (!Number.isFinite(so) || so < 1 || so >= stopByOrd.length) return null;
  const start = stopByOrd[so - 1];
  const end = stopByOrd[so];
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
 * 실제 버스 위치 '지금'을 케이스별로 추정.
 *  st.refAlong = 마지막 fix 위치(a0, sectOrd+진행률 기반), st.refTime = 응답 수신시각(perf)
 *  st.leadMs = 그 fix 의 지연(ms), st.speed = 최근 fix 가중속도, st.stopFlag = 도착여부
 * → { pDes: 지금 위치 추정, vEst: 지금 속도 추정 }
 */
function predict(st, now, sortedStops) {
  const sinceConfirm = (now - st.refTime) / 1000; // 마지막 폴 이후
  const latency = (st.leadMs ?? LEAD_FALLBACK_MS) / 1000; // fix ~ 응답수신
  const dtEl = Math.min(sinceConfirm + latency, MAX_EXTRAP_S); // fix 시각 이후 총 경과
  const a0 = st.refAlong;
  const vh = st.speed;
  const upper = a0 + Math.max(vh, 3) * dtEl * 1.7 + 25; // 그럴듯한 상한

  // 1) 정류장 도착·정차 (stopFlag=1)
  if (st.stopFlag === 1) {
    if (sinceConfirm < CONFIRM_HOLD_S) return { pDes: a0, vEst: 0 };
    const moveT = dtEl - DWELL_TYPICAL; // 확인 끊긴 지 오래 → 승하차 마치고 출발했을 것
    if (moveT <= 0) return { pDes: a0, vEst: 0 };
    const v = vh > 1.5 ? vh : DEPART_V;
    return { pDes: Math.min(a0 + v * moveT, upper), vEst: v };
  }

  // 2) 정차인데 도착 아님 = 신호/정체 (교차로·신호등 옆 정류장 포함)
  if (vh < V_STOP) {
    if (sinceConfirm < CONFIRM_HOLD_S) return { pDes: a0, vEst: 0 };
    const goT = dtEl - SIGNAL_TYPICAL; // 확인 끊긴 지 오래 → 신호 풀렸을 것(불확실)
    if (goT <= 0) return { pDes: a0, vEst: 0 };
    const v = Math.max(vh, SIGNAL_RESUME_V);
    return { pDes: Math.min(a0 + v * goT * 0.8, upper), vEst: v * 0.6 };
  }

  // 3) 주행 중 → 도로형상 추측항법 (앞 정류장 정차시간 반영)
  return {
    pDes: Math.min(leadAlong(a0, vh, dtEl, sortedStops, st.sidx || 0), upper),
    vEst: vh,
  };
}

export function useBusMarkers(map, route, opts = {}) {
  const busesRef = useRef(new Map());
  const clickRef = useRef(null);
  const trackRef = useRef(null);
  const selRef = useRef(null);
  clickRef.current = opts.onBusClick || null;
  trackRef.current = opts.trackedVehicleNo || null;
  selRef.current = opts.selectedVehicleNo || null;

  useEffect(() => {
    if (!map || !route?.path?.length) return undefined;

    const { kakao } = window;
    const path = buildPath(route.path);
    const color = routeTypeColor(route.routeTp);
    const buses = busesRef.current;

    // 정류장 경로상 위치: 순번 순(sectAlong 용) + 오름차순(leadAlong·sidx 용)
    const nStops = route.stops?.length || 0;
    const stopByOrd = (route.stops || []).map(
      (s, idx) =>
        projectOnPath(
          path,
          s,
          nStops > 1 ? (path.total * (idx + 0.5)) / nStops : null,
        ).along,
    );
    const stopSorted = [...stopByOrd].sort((a, b) => a - b);

    function emitClick(b) {
      if (!b || !clickRef.current) return;
      const next = (route.stops || []).find((s) => s.ord === (b.sectOrd || 0) + 1);
      clickRef.current({
        routeId: route.routeId,
        routeNo: route.routeNo,
        routeTp: route.routeTp,
        vehicleNo: b.vehicleNo,
        lowFloor: b.lowFloor,
        congestion: b.congestion,
        sectOrd: b.sectOrd,
        stopFlag: b.stopFlag,
        nextStTm: b.nextStTm,
        dataTm: b.dataTm,
        nextStopName: next ? next.name : null,
      });
    }

    let alive = true;
    let raf = 0;
    let lastFrame = performance.now();
    let scale = zoomScale(map.getLevel());
    let lastTrackCenter = 0;

    const onZoom = () => {
      scale = zoomScale(map.getLevel());
      for (const st of buses.values()) st.overlay.setScale(scale);
    };
    kakao.maps.event.addListener(map, 'zoom_changed', onZoom);

    function frame(now) {
      if (!alive) return;
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;
      const kShow = 1 - Math.exp(-dt / VSHOW_TAU);

      for (const [vno, st] of buses) {
        const { pDes, vEst } = predict(st, now, stopSorted);
        const pD = clamp(pDes, 0, path.total);

        st.vShown += (vEst - st.vShown) * kShow;
        if (st.vShown < 0) st.vShown = 0;

        const gap = pD - st.along;
        if (gap > 0) {
          const corr = Math.min(gap / CORR_TAU, CORR_MAX);
          st.along = Math.min(st.along + (st.vShown + corr) * dt, pD); // 앞으로만, 목표 안 넘김
        }
        st.along = clamp(st.along, 0, path.total);

        const p = pointAtDistance(path, st.along);
        const ll = new kakao.maps.LatLng(p.lat, p.lng);
        st.overlay.setPosition(ll);
        st.overlay.setHeading(p.heading);
        if (vno === trackRef.current && now - lastTrackCenter > 80) {
          map.setCenter(ll);
          lastTrackCenter = now;
        }
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

      const now = performance.now();
      const nowWall = Date.now();
      const seen = new Set();

      for (const b of data.buses) {
        seen.add(b.vehicleNo);
        const st = buses.get(b.vehicleNo);

        const aSect = sectAlong(b, stopByOrd); // sectOrd + 구간진행률 기반 위치
        let hint = st ? st.refAlong : aSect;
        if (hint == null && Number.isFinite(b.sectOrd) && nStops > 1) {
          hint = path.total * clamp(b.sectOrd / nStops, 0, 1);
        }
        const proj = projectOnPath(path, b, hint);
        // GPS 투영과 sectOrd 진행률 위치를 블렌드해 노이즈 감소.
        // 둘이 크게 어긋나면(왕복 공유구간 GPS 오투영 등) 방향이 확실한 sectOrd 채택.
        let a0 = proj.along;
        if (aSect != null) {
          a0 =
            Math.abs(aSect - proj.along) > 400
              ? aSect
              : proj.along * 0.6 + aSect * 0.4;
        }
        const lag = fixLagMs(b.dataTm); // 이 fix 가 얼마나 지난 것인지
        const sampleT = nowWall - lag; // fix 시각(추정) — 속도계산용
        const sidx = sidxFor(stopSorted, a0);
        const leadMs = b.stopFlag === 1 ? 0 : lag; // 예측 전진에 쓰는 지연(도착중이면 0)

        if (!st) {
          const p0 = pointAtDistance(path, a0);
          const vno = b.vehicleNo;
          const overlay = createBusOverlay(
            map,
            new kakao.maps.LatLng(p0.lat, p0.lng),
            color,
            route.routeNo,
            scale,
            () => {
              const cur = buses.get(vno);
              if (cur) emitClick(cur.gps);
            },
          );
          buses.set(vno, {
            overlay,
            along: a0,
            vShown: 0,
            speed: 0,
            refAlong: a0,
            refTime: now,
            leadMs,
            sidx,
            stopFlag: b.stopFlag,
            gps: b,
            samples: [{ along: a0, t: sampleT }],
          });
          continue;
        }

        const lastS = st.samples[st.samples.length - 1];
        if (proj.dist > SNAP_M || Math.abs(a0 - lastS.along) > JUMP_M) {
          // 경로 이탈 / 순환 한 바퀴 → 하드 스냅
          st.along = a0;
          st.vShown = 0;
          st.speed = 0;
          st.samples = [{ along: a0, t: sampleT }];
        } else {
          st.samples.push({ along: a0, t: sampleT });
          if (st.samples.length > WINDOW) st.samples.shift();
          recalcSpeed(st);
        }

        st.refAlong = a0;
        st.refTime = now;
        st.leadMs = leadMs;
        st.sidx = sidx;
        st.stopFlag = b.stopFlag;
        st.gps = b;
        if (b.vehicleNo === selRef.current) emitClick(b);
      }

      for (const [vno, st] of buses) {
        if (!seen.has(vno)) {
          st.overlay.remove();
          buses.delete(vno);
        }
      }
    }

    let pollCount = 0;
    let timer = 0;
    async function loop() {
      await poll();
      if (!alive) return;
      pollCount += 1;
      timer = setTimeout(loop, pollCount < FAST_COUNT ? FAST_MS : SLOW_MS);
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
