import { useEffect, useRef } from 'react';
import { createBusOverlay } from './busOverlay';
import { buildPath, leadAlong, pointAtDistance, projectOnPath, sidxFor } from './busPath';
import { routeTypeColor } from './routeColor';

const FAST_MS = 3000; // 접속 직후: 이 간격으로
const FAST_COUNT = 3; // 이만큼 fetch 해서 평균속도를 빨리 확보한 뒤
const SLOW_MS = 10000; // 이후 통상 폴링 주기
const MAX_EXTRAP_MS = 25000; // 응답이 늦어도 이 시간까지만 외삽(지연보정 포함)
const LEAD_FALLBACK_MS = 7000; // dataTm 없거나 시계 어긋날 때 기본 지연 추정치
const WINDOW = 3; // 평균속도를 낼 때 쓰는 최근 fetch 개수 (짧을수록 최근 움직임에 민감)
const SNAP_M = 120; // 경로에서 이만큼 벗어난 좌표는 보정 없이 스냅 (도로 형상 기준)
const JUMP_M = 3000; // 경로상 이만큼 튀면(순환노선 한 바퀴 등) 스냅
const MAX_SPEED = 18; // m/s (~65km/h) 평균속도 상한
const SMOOTH_TAU = 1.0; // s. 화면 위치가 예측 위치로 수렴하는 시간상수

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// dataTm(KST yyyyMMddHHmmss) → 지금 이 데이터가 얼마나 지난 것인지(ms).
// 기기 시계가 어긋나 값이 비정상이면 기본값 사용.
function estLeadMs(dataTm) {
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
  return lag >= 0 && lag < 40000 ? lag : LEAD_FALLBACK_MS;
}

// 카카오 지도 레벨(1 가까움 ~ 14 멂) → 버스 아이콘 배율
function zoomScale(level) {
  return clamp(1.4 ** (4 - level), 0.45, 2.4);
}

/**
 * 버스를 폴링 주기마다 점프시키지 않고:
 *  - 최근 WINDOW회 fetch의 경로상 평균속도로 fetch 대기 중에도 계속 전진(추측항법)
 *  - 새 응답이 오면 실제 위치로 부드럽게 보정하고 평균속도를 다시 계산
 *  - 접속 직후엔 FAST_MS 간격으로 FAST_COUNT회 받아 평균속도를 빨리 확보
 * 아이콘/번호는 지도 축척에 맞춰 확대축소.
 *
 * route: { routeId, routeNo, routeTp, path: [[lng,lat], ...] }
 */
export function useBusMarkers(map, route, opts = {}) {
  const busesRef = useRef(new Map()); // vehicleNo -> { overlay, along, speed, refAlong, refTime, samples, gps }
  const clickRef = useRef(null);
  const trackRef = useRef(null);
  clickRef.current = opts.onBusClick || null; // 매 렌더 최신값 유지 (오버레이 재생성 없이)
  trackRef.current = opts.trackedVehicleNo || null;

  useEffect(() => {
    if (!map || !route?.path?.length) return undefined;

    const { kakao } = window;
    const path = buildPath(route.path);
    const color = routeTypeColor(route.routeTp);
    const buses = busesRef.current;

    // 각 정류장의 경로상 위치(오름차순) — 지연보정이 정류장을 무시하지 않도록
    const nStops = route.stops?.length || 0;
    const stopAlongs = (route.stops || [])
      .map(
        (s, idx) =>
          projectOnPath(
            path,
            s,
            nStops > 1 ? (path.total * (idx + 0.5)) / nStops : null,
          ).along,
      )
      .sort((a, b) => a - b);

    // 마커 클릭 → 표시용 정보 조립
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

    const onZoom = () => {
      scale = zoomScale(map.getLevel());
      for (const st of buses.values()) st.overlay.setScale(scale);
    };
    kakao.maps.event.addListener(map, 'zoom_changed', onZoom);

    // 연속 rAF 루프: 매 프레임 평균속도로 전진 + 예측치로 수렴
    let lastTrackCenter = 0;
    function frame(now) {
      if (!alive) return;
      const dt = Math.min(0.1, (now - lastFrame) / 1000); // 탭 복귀 시 폭주 방지
      lastFrame = now;
      const k = 1 - Math.exp(-dt / SMOOTH_TAU);
      for (const [vno, st] of buses) {
        // 수신 후 경과 + 수신 시점의 데이터 지연 = 실제 '현재'까지의 시간
        const t = Math.min(
          (now - st.refTime) / 1000 + (st.leadMs ?? LEAD_FALLBACK_MS) / 1000,
          MAX_EXTRAP_MS / 1000,
        );
        // 그만큼 앞선 위치 — 단 앞의 정류장에서 정차 시간을 빼서 지나치지 않게
        const predicted = clamp(
          leadAlong(st.refAlong, st.speed, t, stopAlongs, st.sidx || 0),
          0,
          path.total,
        );
        st.along += (predicted - st.along) * k;
        const p = pointAtDistance(path, st.along);
        const ll = new kakao.maps.LatLng(p.lat, p.lng);
        st.overlay.setPosition(ll);
        // 경로 접선 방위 = 진행방향. 속도 0이어도 항상 세팅되므로 멈춰 있어도 방향 표시됨
        st.overlay.setHeading(p.heading);
        // 위치 트래킹: 이 버스가 대상이면 지도 중심을 계속 맞춤 (기울이지 않음)
        if (vno === trackRef.current && now - lastTrackCenter > 80) {
          map.setCenter(ll);
          lastTrackCenter = now;
        }
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // 최근 WINDOW개 샘플의 처음~끝 구간으로 평균속도 산출
    function recalcSpeed(st) {
      if (st.samples.length < 2) {
        st.speed = 0;
        return;
      }
      const a = st.samples[0];
      const b = st.samples[st.samples.length - 1];
      const dtSec = (b.t - a.t) / 1000;
      st.speed = dtSec > 0 ? clamp((b.along - a.along) / dtSec, 0, MAX_SPEED) : 0;
    }

    async function poll() {
      let data;
      try {
        const res = await fetch(`/api/bus-position?routeId=${route.routeId}`);
        data = await res.json();
      } catch {
        return; // 네트워크 오류 — 이번 주기 스킵, rAF는 마지막 평균속도로 계속 전진
      }
      if (!alive) return;
      if (!Array.isArray(data.buses)) return; // 업스트림 오류 응답 → 스킵(기존 버스 유지)
      const fresh = data.buses;

      const now = performance.now();
      const seen = new Set();

      for (const b of fresh) {
        seen.add(b.vehicleNo);
        const st = buses.get(b.vehicleNo);
        // 왕복 공유구간 대비: 이전 위치(없으면 API sectOrd 비율)로 투영 방향을 고정
        let hint = st ? st.refAlong : null;
        if (hint == null && Number.isFinite(b.sectOrd) && route.stops?.length > 1) {
          const frac = Math.max(0, Math.min(1, b.sectOrd / route.stops.length));
          hint = path.total * frac; // path 는 도로 형상(정류장 수와 점 개수가 다름)
        }
        const proj = projectOnPath(path, b, hint);
        // 데이터 시점에 정류소에 있었으면 데이터-지연 리드는 0 (그 자리에 있을 확률 높음)
        const leadMs = b.stopFlag === 1 ? 0 : estLeadMs(b.dataTm);
        const sidx = sidxFor(stopAlongs, proj.along);

        if (!st) {
          const p0 = pointAtDistance(path, proj.along);
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
            along: proj.along,
            speed: 0,
            refAlong: proj.along,
            refTime: now,
            leadMs,
            sidx,
            gps: b,
            samples: [{ along: proj.along, t: now }],
          });
          continue;
        }

        const last = st.samples[st.samples.length - 1];
        if (proj.dist > SNAP_M || Math.abs(proj.along - last.along) > JUMP_M) {
          // 경로 이탈 / 순환 한 바퀴 → 스냅 후 윈도우 초기화
          st.along = proj.along;
          st.samples = [{ along: proj.along, t: now }];
          st.speed = 0;
        } else {
          st.samples.push({ along: proj.along, t: now });
          if (st.samples.length > WINDOW) st.samples.shift();
          recalcSpeed(st);
        }
        st.refAlong = proj.along;
        st.refTime = now;
        st.leadMs = leadMs;
        st.sidx = sidx;
        st.gps = b;
      }

      for (const [vno, st] of buses) {
        if (!seen.has(vno)) {
          st.overlay.remove();
          buses.delete(vno);
        }
      }
    }

    // 접속 직후 FAST_COUNT회는 FAST_MS 간격, 이후 SLOW_MS 간격
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
