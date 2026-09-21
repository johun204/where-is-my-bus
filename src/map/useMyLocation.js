import { useEffect, useRef, useState } from 'react';
import { haversine } from './busPath';
import { createMyLocation } from './myLocation';

const WALK_WINDOW_MS = 20000; // 보행속도 계산에 쓰는 최근 구간
const WALK_MIN_V = 0.4; // m/s 이 미만이면 '멈춰 있음'(null)
const WALK_MAX_V = 2.2; // m/s 이보다 빠르면 도보가 아님 → 상한으로 자름

/**
 * 현위치를 계속(watchPosition) 추적한다.
 * FAB: (1) 나에게 이동 → (2) 다시 누르면 추적 모드 → (추적 중) 누르면 해제.
 * 추적 모드에서 지도를 드래그/축척변경/회전하면 자동 해제.
 * onHeading(deg): 추적 모드에서 나침반 방위가 갱신될 때마다 호출(지도 방향 회전용).
 * noInitCenter: 첫 위치를 받았을 때 지도를 내 위치로 옮기지 않음
 *               (앱을 다시 켰을 때 이전에 추적하던 버스를 보여주는 중이면 뺏으면 안 됨).
 *
 * 반환 pos: 현재 위치 { lat, lng } (5m 이상 움직일 때만 갱신 — 지터 리렌더 방지)
 * 반환 walkSpeed: 실측 보행속도 m/s. 멈춰 있으면 null(호출부가 평균 보폭으로 가정).
 */
export function useMyLocation(map, onHeading, noInitCenter = false) {
  const [follow, setFollow] = useState(false);
  const [pos, setPos] = useState(null);
  const [walkSpeed, setWalkSpeed] = useState(null);
  const fabRef = useRef(() => {});
  const exitRef = useRef(() => {});
  const noInitRef = useRef(noInitCenter);
  noInitRef.current = noInitCenter;

  useEffect(() => {
    if (!map || !navigator.geolocation) return undefined;
    const { kakao } = window;

    let overlay = null;
    let lastLL = null;
    let centered = false;
    let following = false;
    let didInitCenter = false;
    let orientEvt = null;
    let smoothH = null;

    function onOrient(e) {
      let h = null;
      if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading; // iOS
      else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha; // Android
      if (h == null || Number.isNaN(h)) return;
      const scr = (screen.orientation && screen.orientation.angle) || 0;
      h = (h + scr + 360) % 360;
      if (smoothH == null) smoothH = h;
      else {
        const d = ((h - smoothH + 540) % 360) - 180; // 원형 지수평활
        smoothH = (smoothH + 0.3 * d + 360) % 360;
      }
      overlay?.setHeading(smoothH);
      onHeading?.(smoothH);
    }

    async function startOrient() {
      const D = window.DeviceOrientationEvent;
      if (D && typeof D.requestPermission === 'function') {
        try {
          if ((await D.requestPermission()) !== 'granted') return;
        } catch {
          return;
        }
      }
      orientEvt =
        'ondeviceorientationabsolute' in window
          ? 'deviceorientationabsolute'
          : 'deviceorientation';
      window.addEventListener(orientEvt, onOrient);
    }

    function stopOrient() {
      if (orientEvt) window.removeEventListener(orientEvt, onOrient);
      orientEvt = null;
      smoothH = null;
      overlay?.setHeading(null);
    }

    function setFollowing(v) {
      following = v;
      setFollow(v);
    }

    function enterFollow() {
      setFollowing(true);
      centered = true;
      if (lastLL) map.panTo(lastLL);
      startOrient();
    }

    function exitFollow(snap) {
      if (!following) return;
      setFollowing(false);
      stopOrient();
      // 진행 중인 panTo 애니메이션을 확정 위치로 즉시 멈춤 (이후 드래그가 겹치지 않도록).
      // dragstart 로 인한 해제(snap=false)는 카카오가 이미 드래그 중이라 건드리지 않음.
      if (snap && lastLL) map.setCenter(lastLL);
    }
    exitRef.current = () => exitFollow(true);

    let lastPos = null;
    const track = []; // 보행속도용 최근 좌표 샘플

    function onPos(p) {
      const next = { lat: p.coords.latitude, lng: p.coords.longitude };
      lastLL = new kakao.maps.LatLng(next.lat, next.lng);
      if (!overlay) overlay = createMyLocation(map, lastLL);
      else overlay.setPosition(lastLL);

      // 보행속도: 브라우저가 coords.speed 를 주면 그게 가장 정확하고,
      // 없으면 최근 20초 이동거리로 낸다.
      const now = Date.now();
      track.push({ ...next, t: now });
      while (track.length > 1 && now - track[0].t > WALK_WINDOW_MS) track.shift();
      let v = Number.isFinite(p.coords.speed) && p.coords.speed >= 0 ? p.coords.speed : null;
      if (v == null && track.length > 1) {
        const dt = (now - track[0].t) / 1000;
        if (dt > 3) {
          let d = 0;
          for (let i = 1; i < track.length; i++) d += haversine(track[i - 1], track[i]);
          v = d / dt;
        }
      }
      const walk = v != null && v >= WALK_MIN_V ? Math.min(v, WALK_MAX_V) : null;
      setWalkSpeed((prev) => {
        const r = walk == null ? null : Math.round(walk * 10) / 10;
        return r === prev ? prev : r;
      });

      if (!lastPos || haversine(lastPos, next) > 5) {
        lastPos = next;
        setPos(next);
      }

      if (!didInitCenter) {
        didInitCenter = true;
        centered = true;
        if (!noInitRef.current) map.setCenter(lastLL);
      }
      if (following) map.panTo(lastLL);
    }

    const watchId = navigator.geolocation.watchPosition(onPos, () => {}, {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 12000,
    });

    const onUserPan = () => {
      centered = false;
      exitFollow(false);
    };
    const onUserZoom = () => exitFollow(true);
    kakao.maps.event.addListener(map, 'dragstart', onUserPan);
    kakao.maps.event.addListener(map, 'zoom_changed', onUserZoom);

    fabRef.current = () => {
      if (following) {
        exitFollow();
        return;
      }
      if (!lastLL) {
        navigator.geolocation.getCurrentPosition(onPos, () => {}, {
          enableHighAccuracy: true,
          timeout: 10000,
        });
        return;
      }
      if (centered) enterFollow();
      else {
        map.panTo(lastLL);
        centered = true;
      }
    };

    return () => {
      navigator.geolocation.clearWatch(watchId);
      kakao.maps.event.removeListener(map, 'dragstart', onUserPan);
      kakao.maps.event.removeListener(map, 'zoom_changed', onUserZoom);
      stopOrient();
      overlay?.remove();
      fabRef.current = () => {};
      exitRef.current = () => {};
    };
  }, [map, onHeading]);

  return {
    follow,
    pos,
    walkSpeed,
    onFab: () => fabRef.current(),
    exitFollow: () => exitRef.current(),
  };
}
