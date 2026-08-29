import { useEffect, useRef, useState } from 'react';
import { createMyLocation } from './myLocation';

/**
 * 현위치를 계속(watchPosition) 추적한다.
 * FAB: (1) 나에게 이동 → (2) 다시 누르면 추적 모드 → (추적 중) 누르면 해제.
 * 추적 모드에서 지도를 드래그/축척변경/회전하면 자동 해제.
 * onHeading(deg): 추적 모드에서 나침반 방위가 갱신될 때마다 호출(지도 방향 회전용).
 */
export function useMyLocation(map, onHeading) {
  const [follow, setFollow] = useState(false);
  const fabRef = useRef(() => {});
  const exitRef = useRef(() => {});

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

    function onPos(p) {
      lastLL = new kakao.maps.LatLng(p.coords.latitude, p.coords.longitude);
      if (!overlay) overlay = createMyLocation(map, lastLL);
      else overlay.setPosition(lastLL);

      if (!didInitCenter) {
        didInitCenter = true;
        centered = true;
        map.setCenter(lastLL);
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
    onFab: () => fabRef.current(),
    exitFollow: () => exitRef.current(),
  };
}
