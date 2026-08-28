import { useEffect, useRef } from 'react';
import { createBusOverlay } from './busOverlay';
import { buildPath, pointAtDistance, projectOnPath } from './busPath';
import { routeTypeColor } from './routeColor';

const POLL_MS = 15000; // 실시간 위치 폴링 주기
const WINDOW = 5; // 평균속도를 낼 때 쓰는 최근 fetch 개수
const SNAP_M = 250; // 경로에서 이만큼 벗어난 좌표는 보정 없이 스냅
const JUMP_M = 3000; // 경로상 이만큼 튀면(순환노선 한 바퀴 등) 스냅
const MAX_SPEED = 18; // m/s (~65km/h) 평균속도 상한
const SMOOTH_TAU = 1.0; // s. 화면 위치가 예측 위치로 수렴하는 시간상수

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// 카카오 지도 레벨(1 가까움 ~ 14 멂) → 버스 아이콘 배율
function zoomScale(level) {
  return clamp(1.4 ** (4 - level), 0.45, 2.4);
}

/**
 * 버스를 폴링 주기마다 점프시키지 않고:
 *  - 최근 5회 fetch의 경로상 평균속도로 fetch 대기 중에도 계속 전진(추측항법)
 *  - 새 응답이 오면 실제 위치로 부드럽게 보정하고 평균속도를 다시 계산
 * 아이콘/번호는 지도 축척에 맞춰 확대축소.
 *
 * route: { routeId, routeNo, routeTp, path: [[lng,lat], ...] }
 */
export function useBusMarkers(map, route) {
  const busesRef = useRef(new Map()); // vehicleNo -> { overlay, along, speed, refAlong, refTime, samples }

  useEffect(() => {
    if (!map || !route?.path?.length) return undefined;

    const { kakao } = window;
    const path = buildPath(route.path);
    const color = routeTypeColor(route.routeTp);
    const buses = busesRef.current;
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
    function frame(now) {
      if (!alive) return;
      const dt = Math.min(0.1, (now - lastFrame) / 1000); // 탭 복귀 시 폭주 방지
      lastFrame = now;
      const k = 1 - Math.exp(-dt / SMOOTH_TAU);
      for (const st of buses.values()) {
        const age = Math.min((now - st.refTime) / 1000, (POLL_MS * 2) / 1000);
        const predicted = clamp(st.refAlong + st.speed * age, 0, path.total);
        st.along += (predicted - st.along) * k;
        const p = pointAtDistance(path, st.along);
        st.overlay.setPosition(new kakao.maps.LatLng(p.lat, p.lng));
        // 경로 접선 방위 = 진행방향. 속도 0이어도 항상 세팅되므로 멈춰 있어도 방향 표시됨
        st.overlay.setHeading(p.heading);
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
      let fresh;
      try {
        const res = await fetch(`/api/bus-position?routeId=${route.routeId}`);
        fresh = (await res.json()).buses ?? [];
      } catch {
        return; // 이번 주기 스킵 — rAF는 마지막 평균속도로 계속 전진
      }
      if (!alive) return;

      const now = performance.now();
      const seen = new Set();

      for (const b of fresh) {
        seen.add(b.vehicleNo);
        const proj = projectOnPath(path, b);
        let st = buses.get(b.vehicleNo);

        if (!st) {
          const p0 = pointAtDistance(path, proj.along);
          const overlay = createBusOverlay(
            map,
            new kakao.maps.LatLng(p0.lat, p0.lng),
            color,
            route.routeNo,
            scale,
          );
          buses.set(b.vehicleNo, {
            overlay,
            along: proj.along,
            speed: 0,
            refAlong: proj.along,
            refTime: now,
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
      }

      for (const [vno, st] of buses) {
        if (!seen.has(vno)) {
          st.overlay.remove();
          buses.delete(vno);
        }
      }
    }

    poll();
    const timer = setInterval(poll, POLL_MS);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      clearInterval(timer);
      kakao.maps.event.removeListener(map, 'zoom_changed', onZoom);
      for (const st of buses.values()) st.overlay.remove();
      buses.clear();
    };
  }, [map, route?.routeId]); // eslint-disable-line react-hooks/exhaustive-deps
}
