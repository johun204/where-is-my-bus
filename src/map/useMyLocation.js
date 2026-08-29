import { useEffect, useRef, useState } from 'react';
import { createMyLocation } from './myLocation';

/**
 * 현위치를 계속(watchPosition) 추적한다.
 * FAB 동작:
 *   - 위치 아직 없음     → 강제 1회 측위
 *   - 중심이 내가 아님   → 나에게로 이동
 *   - 이미 나에게 중심   → 추적 모드 진입 (지도가 나를 계속 따라오고, 바라보는 방향 콘 표시)
 *   - 추적 모드 중       → 해제
 * 추적 모드는 사용자가 지도를 드래그하거나 축척을 바꾸면 자동 해제된다.
 */
export function useMyLocation(map) {
  const [follow, setFollow] = useState(false);
  const fabRef = useRef(() => {});

  useEffect(() => {
    if (!map || !navigator.geolocation) return undefined;
    const { kakao } = window;

    let overlay = null;
    let lastLL = null;
    let centered = false;
    let following = false;
    let didInitCenter = false;
    let orientEvt = null;

    function onOrient(e) {
      let h = null;
      if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading; // iOS
      else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha; // Android
      if (h == null || Number.isNaN(h)) return;
      const scr = (screen.orientation && screen.orientation.angle) || 0;
      overlay?.setHeading((h + scr + 360) % 360);
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

    function exitFollow() {
      if (!following) return;
      setFollowing(false);
      stopOrient();
    }

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
      exitFollow();
    };
    const onUserZoom = () => exitFollow(); // 축척 변경도 추적 해제
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
    };
  }, [map]);

  return { follow, onFab: () => fabRef.current() };
}
