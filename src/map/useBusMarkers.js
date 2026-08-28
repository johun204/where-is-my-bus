import { useEffect, useRef } from 'react';
import { createBusOverlay } from './busOverlay';
import { buildPath, pointAtDistance, projectOnPath } from './busPath';
import { routeTypeColor } from './routeColor';

const POLL_MS = 15000; // 실시간 위치 폴링 주기
const SNAP_M = 250; // 경로에서 이만큼 벗어난 좌표는 보정 없이 스냅
const JUMP_M = 3000; // 경로상 이만큼 튀면(순환노선 한 바퀴 등) 스냅
const MAX_SPEED = 18; // m/s (~65km/h). 평균속도 상한 (GPS 노이즈 컷)
const SPEED_EMA = 0.5; // 신규 측정치 반영 비율. 노선 GPS가 튀어서 지수평활
const SMOOTH_TAU = 1.0; // s. 화면 위치가 예측 위치로 수렴하는 시간상수

/**
 * 버스를 폴링 주기마다 점프시키지 않고,
 *  - 직전 두 응답으로 "경로상 평균속도"를 구해 fetch 대기 중에도 계속 전진시키고(추측항법)
 *  - 새 응답이 오면 실제 위치로 부드럽게 보정하고 평균속도를 다시 계산한다.
 *
 * route: { routeId, routeTp, path: [[lng,lat], ...] }
 */
export function useBusMarkers(map, route) {
  const busesRef = useRef(new Map()); // vehicleNo -> { overlay, along, speed, refAlong, refTime }

  useEffect(() => {
    if (!map || !route?.path?.length) return undefined;

    const { kakao } = window;
    const path = buildPath(route.path);
    const color = routeTypeColor(route.routeTp);
    const buses = busesRef.current;
    let alive = true;
    let raf = 0;
    let lastFrame = performance.now();

    // 연속 rAF 루프: 매 프레임 모든 버스를 평균속도로 전진 + 예측치로 수렴
    function frame(now) {
      if (!alive) return;
      const dt = Math.min(0.1, (now - lastFrame) / 1000); // 탭 비활성 복귀 시 폭주 방지
      lastFrame = now;
      const k = 1 - Math.exp(-dt / SMOOTH_TAU);

      for (const st of buses.values()) {
        // 마지막 보정 시점 기준 경과시간(최대 2주기까지만 외삽)
        const age = Math.min((now - st.refTime) / 1000, (POLL_MS * 2) / 1000);
        const predicted = clamp(st.refAlong + st.speed * age, 0, path.total);
        // ponytail: 지수 수렴만. 폴 1회 누락 후 큰 보정은 빠른 슬라이드로 보임(스냅 임계 JUMP_M 이하일 때)
        st.along += (predicted - st.along) * k;

        const p = pointAtDistance(path, st.along);
        st.overlay.setPosition(new kakao.maps.LatLng(p.lat, p.lng));
        st.overlay.setHeading(p.heading - 90); // SVG 버스가 '위' 기준 → -90 보정
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    async function poll() {
      let fresh;
      try {
        const res = await fetch(`/api/bus-position?routeId=${route.routeId}`);
        fresh = (await res.json()).buses ?? [];
      } catch {
        return; // 이번 주기 스킵 — rAF 루프는 마지막 평균속도로 계속 전진
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
          );
          buses.set(b.vehicleNo, {
            overlay,
            along: proj.along,
            speed: 0,
            refAlong: proj.along,
            refTime: now,
          });
          continue;
        }

        const dtSec = (now - st.refTime) / 1000;
        if (proj.dist > SNAP_M || Math.abs(proj.along - st.refAlong) > JUMP_M) {
          // 경로 이탈 / 순환 한 바퀴 → 스냅, 속도 초기화
          st.along = proj.along;
          st.speed = 0;
        } else if (dtSec > 0.5) {
          // 경로상 평균속도 재계산 (뒤로 가는 값/과속은 클램프 후 지수평활)
          const measured = clamp((proj.along - st.refAlong) / dtSec, 0, MAX_SPEED);
          st.speed = SPEED_EMA * measured + (1 - SPEED_EMA) * st.speed;
        }
        st.refAlong = proj.along;
        st.refTime = now;
      }

      // 응답에서 사라진 차량 제거
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
      for (const st of buses.values()) st.overlay.remove();
      buses.clear();
    };
  }, [map, route?.routeId]); // eslint-disable-line react-hooks/exhaustive-deps
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
