import { useEffect, useRef } from 'react';
import { createBusOverlay } from './busOverlay';
import { buildPath, pointAtDistance, projectOnPath } from './busPath';
import { routeTypeColor } from './routeColor';

const POLL_MS = 15000; // 15초 폴링
const SNAP_M = 250; // 경로에서 이만큼 벗어나면 보간 없이 스냅
const JUMP_M = 3000; // 경로상 이만큼 튀면 스냅

/**
 * 실시간 버스 위치를 폴링하고, 직전 좌표 → 새 좌표 사이를
 * 노선 경로를 따라 보간(rAF)해 부드럽게 이동시킨다.
 *
 * route: { routeId, routeTp, path: [[lng,lat], ...] }
 */
export function useBusMarkers(map, route) {
  const busesRef = useRef(new Map()); // vehicleNo -> state

  useEffect(() => {
    if (!map || !route?.path?.length) return undefined;

    const { kakao } = window;
    const path = buildPath(route.path);
    const color = routeTypeColor(route.routeTp);
    const buses = busesRef.current;
    let alive = true;

    function tween(st) {
      cancelAnimationFrame(st.raf);
      const from = st.along;
      const to = st.target;
      const start = performance.now();
      const step = (now) => {
        if (!alive) return;
        const k = Math.min(1, (now - start) / POLL_MS);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // easeInOutQuad
        st.along = from + (to - from) * e;
        const p = pointAtDistance(path, st.along);
        st.overlay.setPosition(new kakao.maps.LatLng(p.lat, p.lng));
        st.overlay.setHeading(p.heading - 90); // SVG 버스가 '위' 기준 → -90 보정
        if (k < 1) st.raf = requestAnimationFrame(step);
      };
      st.raf = requestAnimationFrame(step);
    }

    async function poll() {
      let fresh;
      try {
        const res = await fetch(
          `/api/bus-position?routeId=${route.routeId}&cityCode=25`,
        );
        fresh = (await res.json()).buses ?? [];
      } catch {
        return; // 이번 주기 스킵, 다음 폴링에서 복구
      }
      if (!alive) return;

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
          st = { overlay, along: proj.along, target: proj.along, raf: 0 };
          buses.set(b.vehicleNo, st);
        }

        // 경로 이탈 / 과도한 점프 → 순간이동으로 정정
        if (proj.dist > SNAP_M || Math.abs(proj.along - st.along) > JUMP_M) {
          st.along = proj.along;
        }
        st.target = proj.along;
        tween(st);
      }

      // 응답에서 사라진 차량 제거
      for (const [vno, st] of buses) {
        if (!seen.has(vno)) {
          cancelAnimationFrame(st.raf);
          st.overlay.remove();
          buses.delete(vno);
        }
      }
    }

    poll();
    const timer = setInterval(poll, POLL_MS);

    return () => {
      alive = false;
      clearInterval(timer);
      for (const [, st] of buses) {
        cancelAnimationFrame(st.raf);
        st.overlay.remove();
      }
      buses.clear();
    };
  }, [map, route?.routeId]); // eslint-disable-line react-hooks/exhaustive-deps
}
