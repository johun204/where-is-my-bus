import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { useFavoriteRoutes } from './hooks/useFavoriteRoutes';
import { RouteLayer } from './map/RouteLayer';
import { StopsLayer } from './map/StopsLayer';
import { haversine } from './map/busPath';
import { catchProb, walkSeconds } from './map/catchBus';
import { routeTypeColor } from './map/routeColor';
import { useMyLocation } from './map/useMyLocation';

const FALLBACK = { lat: 37.5665, lng: 126.978 }; // 서울시청 (위치 권한 거부 시)

// 추적 중이던 버스를 앱을 껐다 켜도 이어서 본다. 마지막 좌표도 같이 저장해 두면
// API 응답이 오기 전에도 지도를 그 자리에 먼저 띄울 수 있다.
const TRACK_KEY = 'busmap.track.v1';
const REF_KEY = 'busmap.refstop.v1'; // 기준 정류장 — "몇 정거장 전" 의 기준
const KEEP_TTL_MS = 6 * 60 * 60 * 1000; // 이보다 오래되면 무의미(그 버스는 이미 차고지)
const SAVE_MIN_MS = 5000; // 좌표 저장 최소 간격

function loadKept(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && Date.now() - v.t < KEEP_TTL_MS ? v : null;
  } catch {
    return null;
  }
}
function keep(key, v) {
  try {
    if (v) localStorage.setItem(key, JSON.stringify({ ...v, t: Date.now() }));
    else localStorage.removeItem(key);
  } catch {
    /* 사파리 사생활 모드 등 — 저장 못 해도 동작에는 지장 없음 */
  }
}
const loadTrack = () => {
  const v = loadKept(TRACK_KEY);
  return v && v.routeId && v.vehicleNo ? v : null;
};

const CONGESTION = { 3: '여유', 4: '보통', 5: '혼잡', 6: '매우 혼잡' };

const agoText = (dataTm) => {
  if (!/^\d{14}$/.test(dataTm || '')) return null;
  const s = dataTm;
  const epoch = Date.UTC(
    +s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
    +s.slice(8, 10) - 9, +s.slice(10, 12), +s.slice(12, 14),
  );
  const sec = Math.round((Date.now() - epoch) / 1000);
  if (sec < 0 || sec > 3600) return null;
  return sec < 60 ? `${sec}초 전` : `${Math.floor(sec / 60)}분 전`;
};

const minText = (sec) => {
  if (sec == null) return null;
  if (sec < 45) return '곧 도착';
  if (sec < 90) return '1분';
  return `${Math.round(sec / 60)}분`;
};

// 소요시간(도보·다음 정류장 등). '곧 도착' 같은 판정 없이 있는 그대로.
const spanText = (sec) => {
  if (sec == null) return null;
  if (sec < 60) return `${sec}초`;
  return `약 ${Math.round(sec / 60)}분`;
};

const probClass = (p) => (p >= 0.7 ? ' is-ok' : p >= 0.4 ? ' is-mid' : ' is-no');

export default function App() {
  const mapEl = useRef(null);
  const rotEl = useRef(null); // 회전 래퍼 (--map-rot CSS 변수 소유)
  const stageEl = useRef(null);
  const mapRotRef = useRef(0);
  const rotSrcRef = useRef('none'); // 'follow' | 'manual' — 회전 값의 출처
  const prevFollowRef = useRef(false);
  const followRef = useRef(false);

  const [map, setMap] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [installEvt, setInstallEvt] = useState(null);
  const [rotated, setRotated] = useState(false);
  const [toast, setToast] = useState(null);
  const [popup, setPopup] = useState(null); // 버스 마커 탭
  const [stopPop, setStopPop] = useState(null); // 정류장 마커 탭

  const [tracked, setTracked] = useState(loadTrack); // { routeId, routeNo, routeTp, vehicleNo }
  const [trackStat, setTrackStat] = useState(null); // 추적 중 1초마다 오는 최신 정보
  const [centering, setCentering] = useState(true); // 지도를 버스에 붙여 따라갈지
  // "몇 정거장 전" 의 기준이 되는 정류장. 정류장을 탭할 때만 정해진다(현위치로 추측하지 않음).
  const [refStop, setRefStop] = useState(() => loadKept(REF_KEY));
  const [onlyRef, setOnlyRef] = useState(false); // 기준 정류장 경유 노선만 지도에 표시
  const [routeStops, setRouteStops] = useState({}); // routeId -> arsId[] (노선이 서는 정류장)

  const initTrackRef = useRef(tracked); // 마운트 시점의 복원값(지도 초기 중심용)
  const lastSaveRef = useRef(0);
  const { favorites, has, toggle, toggleEnabled } = useFavoriteRoutes();

  const flash = useCallback((msg) => setToast(msg), []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const applyRot = useCallback((deg, src) => {
    rotSrcRef.current = src;
    mapRotRef.current = deg;
    rotEl.current?.style.setProperty('--map-rot', `${deg}deg`);
    const m = ((deg % 360) + 360) % 360;
    setRotated(m > 0.5 && m < 359.5);
  }, []);

  // 추적 모드: 바라보는 방향이 항상 지도 12시가 되도록 지도를 -heading 만큼 회전
  const onHeading = useCallback((deg) => applyRot(-deg, 'follow'), [applyRot]);

  const { follow, pos: myPos, walkSpeed, onFab, exitFollow } = useMyLocation(
    map,
    onHeading,
    Boolean(initTrackRef.current), // 복원된 버스를 보여주는 중이면 내 위치로 뺏지 않음
  );

  // 지도 생성 — 복원된 추적이 있으면 그 버스의 마지막 좌표에서 시작(응답 대기 중에도 바로 보임)
  useEffect(() => {
    window.kakao.maps.load(() => {
      const init = initTrackRef.current;
      const c = init && init.lat && init.lng ? init : FALLBACK;
      const m = new window.kakao.maps.Map(mapEl.current, {
        center: new window.kakao.maps.LatLng(c.lat, c.lng),
        level: 4,
      });
      window.kakao.maps.event.addListener(m, 'click', () => {
        setResults(null);
        setPopup(null);
        setStopPop(null);
      });
      setMap(m);
    });
  }, []);

  // 복원한 추적의 노선이 즐겨찾기에서 빠졌으면(=지도에 안 그려짐) 추적도 정리
  useEffect(() => {
    const t = initTrackRef.current;
    if (t && !favorites.some((f) => f.routeId === t.routeId)) setTracked(null);
    // 마운트 시 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    keep(TRACK_KEY, tracked);
    setCentering(true); // 새로 추적을 시작하면 다시 지도를 버스에 붙인다
  }, [tracked]);

  useEffect(() => {
    keep(REF_KEY, refStop);
  }, [refStop]);

  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

  // 정류장 도착정보: 열려 있는 동안 20초마다 갱신
  useEffect(() => {
    const arsId = stopPop?.arsId;
    if (!arsId) return undefined;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/arrivals?arsId=${encodeURIComponent(arsId)}`);
        const d = await r.json();
        if (!alive) return;
        setStopPop((p) =>
          p && p.arsId === arsId
            ? Array.isArray(d.arrivals)
              ? { ...p, loading: false, error: false, arrivals: d.arrivals, name: d.stopName || p.name }
              : { ...p, loading: false, error: true }
            : p,
        );
      } catch {
        if (alive) setStopPop((p) => (p && p.arsId === arsId ? { ...p, loading: false, error: true } : p));
      }
    };
    load();
    const t = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [stopPop?.arsId]);

  const onBusClick = useCallback((info) => {
    setResults(null);
    setStopPop(null);
    setPopup(info);
  }, []);

  // 정류장 열기: 기준 정류장으로 잡고 도착정보 시트를 연다.
  // pan=true 면 지도도 그 정류장으로 옮긴다(하단 기준정류장 카드를 탭한 경우).
  const openStop = useCallback(
    (s, pan = false) => {
      setResults(null);
      setPopup(null);
      // 탭한 정류장이 "몇 정거장 전"의 기준이자 도보 안내·점선의 목적지
      setRefStop({ arsId: s.arsId, name: s.name, lat: s.lat, lng: s.lng });
      setStopPop({ arsId: s.arsId, name: s.name, loading: true, error: false, arrivals: null });
      if (pan && map && s.lat) {
        setCentering(false); // 버스 따라가기와 충돌하지 않게
        map.panTo(new window.kakao.maps.LatLng(s.lat, s.lng));
      }
    },
    [map],
  );

  const onStopClick = useCallback((s) => openStop(s), [openStop]);

  const onRouteStops = useCallback((routeId, arsIds) => {
    setRouteStops((p) => (p[routeId] ? p : { ...p, [routeId]: arsIds }));
  }, []);

  // 내 위치 → 기준 정류장. 걷는 중이면 실측 보행속도, 멈춰 있으면 평균 보폭 기준.
  const walk = useMemo(() => {
    if (!myPos || !refStop?.lat) return null;
    const meters = Math.round(haversine(myPos, refStop));
    return { meters, sec: walkSeconds(meters, walkSpeed), moving: walkSpeed != null };
  }, [myPos, refStop, walkSpeed]);

  // 선택한 정류장까지 연한 회색 점선 (실제 도보 경로가 아니라 방향·거리 감만 주는 용도)
  useEffect(() => {
    if (!map || !myPos || !refStop?.lat) return undefined;
    const { kakao } = window;
    const line = new kakao.maps.Polyline({
      path: [
        new kakao.maps.LatLng(myPos.lat, myPos.lng),
        new kakao.maps.LatLng(refStop.lat, refStop.lng),
      ],
      strokeWeight: 3,
      strokeColor: '#9aa0a8',
      strokeOpacity: 0.9,
      strokeStyle: 'shortdash',
    });
    line.setMap(map);
    return () => line.setMap(null);
  }, [map, myPos, refStop]);

  const startTrack = useCallback(
    (info) => {
      exitFollow(); // 내 위치 추적과 상호 배타
      setTracked({
        routeId: info.routeId,
        routeNo: info.routeNo,
        routeTp: info.routeTp,
        vehicleNo: info.vehicleNo,
      });
      setTrackStat(info);
      setPopup(null);
      setStopPop(null);
      setAutoRouteId(null);
      if (map && map.getLevel() > 5) map.setLevel(4);
    },
    [exitFollow, map],
  );

  const onTrackStat = useCallback((info) => {
    setTrackStat(info);
    const now = Date.now();
    if (now - lastSaveRef.current < SAVE_MIN_MS) return;
    lastSaveRef.current = now;
    keep(TRACK_KEY, {
      routeId: info.routeId,
      routeNo: info.routeNo,
      routeTp: info.routeTp,
      vehicleNo: info.vehicleNo,
      lat: info.lat,
      lng: info.lng,
    });
  }, []);

  const onTrackLost = useCallback(() => {
    setTracked(null);
    flash('추적하던 버스가 운행을 마쳤어요.');
  }, [flash]);

  const handleFab = () => {
    setCentering(false); // 내 위치를 보겠다는 뜻 — 버스 따라가기는 잠시 멈춤
    onFab();
  };

  const northUp = () => applyRot(0, 'manual');

  // 노선 칩 탭 = 그 노선을 지도에서 껐다 켜기
  const onChip = (r) => {
    const turningOff = r.enabled !== false;
    if (turningOff && tracked?.routeId === r.routeId) setTracked(null); // 안 보이는 버스는 못 따라감
    toggleEnabled(r.routeId);
  };

  const removeRoute = (r) => {
    if (tracked?.routeId === r.routeId) setTracked(null);
    toggle(r);
  };

  // 추적 중인 버스가 지도를 직접 움직이면 '따라가기'만 끈다(추적 자체는 유지)
  useEffect(() => {
    if (!map || !tracked) return undefined;
    const { kakao } = window;
    const release = () => setCentering(false);
    kakao.maps.event.addListener(map, 'dragstart', release);
    return () => kakao.maps.event.removeListener(map, 'dragstart', release);
  }, [map, tracked]);

  // 추적 해제 시(드래그/줌 등) 정북으로 복귀 — 단, 사용자가 직접 돌린 각도는 유지
  useEffect(() => {
    if (prevFollowRef.current && !follow && rotSrcRef.current === 'follow') {
      applyRot(0, 'follow');
    }
    prevFollowRef.current = follow;
  }, [follow, applyRot]);

  // 두 손가락 비틀기 = 회전 / 회전된 상태의 한 손가락 이동 = 화면 기준으로 팬(카카오 대체)
  useEffect(() => {
    const stage = stageEl.current;
    if (!stage || !map) return undefined;
    const { kakao } = window;
    const ang = (t) =>
      (Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX) * 180) /
      Math.PI;
    const dist = (t) =>
      Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);
    const rotAmount = () => {
      const m = ((mapRotRef.current % 360) + 360) % 360;
      return m > 0.5 && m < 359.5 ? m : 0; // 정북이면 0 (카카오 기본 팬 사용)
    };
    let g = null; // 2손가락 제스처
    let pan = null; // 회전 상태 1손가락 팬

    const onStart = (e) => {
      if (e.touches.length === 1 && followRef.current) {
        // 추적 모드에서 손 대는 즉시 해제 + 전환 없이 정북 복귀
        exitFollow();
        const el = rotEl.current;
        if (el) {
          el.style.transition = 'none';
          applyRot(0, 'follow');
          void el.offsetWidth;
          el.style.transition = '';
        }
        return;
      }
      if (e.touches.length === 1 && rotAmount() !== 0) {
        pan = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        return;
      }
      if (e.touches.length === 2) {
        pan = null;
        g = {
          a0: ang(e.touches),
          d0: dist(e.touches),
          r0: mapRotRef.current,
          lvl0: map.getLevel(),
          mode: null,
        };
      }
    };

    // 화면 좌표 → 지도 div 컨테이너 좌표 (회전 보정). 핀치 앵커 계산용.
    const screenToContainer = (sx, sy) => {
      const r = stage.getBoundingClientRect();
      const ox = sx - (r.left + r.width / 2);
      const oy = sy - (r.top + r.height / 2);
      const rad = (-mapRotRef.current * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const proj = map.getProjection();
      const cd = proj.containerPointFromCoords(map.getCenter());
      return new kakao.maps.Point(cd.x + ox * cos - oy * sin, cd.y + ox * sin + oy * cos);
    };

    const onMove = (e) => {
      // 회전된 지도의 한 손가락 팬: 화면 델타를 -회전각으로 되돌려 카카오 좌표로 이동
      if (pan && e.touches.length === 1) {
        const rot = rotAmount();
        if (rot === 0) {
          pan = null;
          return;
        }
        setCentering(false); // 직접 이동 → 버스 따라가기 중단
        e.stopPropagation();
        e.preventDefault();
        const t = e.touches[0];
        const dx = t.clientX - pan.x;
        const dy = t.clientY - pan.y;
        pan.x = t.clientX;
        pan.y = t.clientY;
        const rad = (-rot * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const mdx = dx * cos - dy * sin; // 스크린 델타 → 지도 div 델타
        const mdy = dx * sin + dy * cos;
        const proj = map.getProjection();
        const c = proj.containerPointFromCoords(map.getCenter());
        map.setCenter(
          proj.coordsFromContainerPoint(new kakao.maps.Point(c.x - mdx, c.y - mdy)),
        );
        return;
      }

      if (!g || e.touches.length !== 2) return;
      let da = ang(e.touches) - g.a0;
      da = ((da + 540) % 360) - 180;
      const scale = dist(e.touches) / g.d0;
      if (!g.mode) {
        if (Math.abs(da) > 10 && Math.abs(scale - 1) < 0.2) g.mode = 'rotate';
        else if (Math.abs(scale - 1) > 0.15) g.mode = 'zoom';
      }

      if (g.mode === 'rotate') {
        e.stopPropagation();
        e.preventDefault();
        let r = g.r0 + da;
        const m = ((r % 360) + 360) % 360;
        if (m < 4 || m > 356) r = Math.round(r / 360) * 360; // 정북 근처 스냅
        applyRot(r, 'manual');
        exitFollow();
        return;
      }

      if (g.mode === 'zoom') {
        if (rotAmount() === 0) return; // 정북이면 카카오 기본 핀치줌 사용
        e.stopPropagation();
        e.preventDefault();
        const target = Math.max(1, Math.min(13, Math.round(g.lvl0 - Math.log2(scale))));
        if (target !== map.getLevel()) {
          const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          const anchor = map
            .getProjection()
            .coordsFromContainerPoint(screenToContainer(mx, my));
          map.setLevel(target, { anchor });
          g.lvl0 = target; // 재기준 (누적 오차 방지)
          g.d0 = dist(e.touches);
        }
      }
    };

    const onEnd = (e) => {
      if (e.touches.length < 1) pan = null;
      if (e.touches.length < 2) g = null;
    };

    stage.addEventListener('touchstart', onStart, { capture: true, passive: false });
    stage.addEventListener('touchmove', onMove, { capture: true, passive: false });
    stage.addEventListener('touchend', onEnd, { capture: true });
    stage.addEventListener('touchcancel', onEnd, { capture: true });
    return () => {
      stage.removeEventListener('touchstart', onStart, true);
      stage.removeEventListener('touchmove', onMove, true);
      stage.removeEventListener('touchend', onEnd, true);
      stage.removeEventListener('touchcancel', onEnd, true);
    };
  }, [map, applyRot, exitFollow]);

  // PWA 설치 프롬프트 캡처
  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setInstallEvt(e);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  async function search(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const r = await fetch(`/api/route?routeNo=${encodeURIComponent(q)}`);
      const d = await r.json();
      setResults(Array.isArray(d.results) ? d.results : []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function install() {
    if (!installEvt) return;
    installEvt.prompt();
    await installEvt.userChoice;
    setInstallEvt(null);
  }

  // 도착정보 한 줄. 내 도보 시간을 알면 "탈 수 있을 확률"을 작게 덧붙인다.
  const arrItem = (a) => {
    const p = catchProb(a.arr1?.sec, walk?.sec);
    return (
      <li key={a.routeId || a.routeNo}>
        <span className="arr__no" style={{ background: routeTypeColor(a.routeType) }}>
          {a.routeNo}
        </span>
        <span className="arr__body">
          {a.dir && <span className="arr__dir">{a.dir} 방면</span>}
          <span className="arr__t1">{a.arr1 ? a.arr1.msg : '정보 없음'}</span>
          {a.arr2 && <span className="arr__t2">다음: {a.arr2.msg}</span>}
          {p != null && (
            <span className={`arr__p${probClass(p)}`}>탈 확률 {Math.round(p * 100)}%</span>
          )}
        </span>
        {a.routeId && (
          <button
            className={`arr__add${has(a.routeId) ? ' is-added' : ''}`}
            disabled={has(a.routeId)}
            onClick={() =>
              toggle({ routeId: a.routeId, routeNo: a.routeNo, routeTp: a.routeType })
            }
          >
            {has(a.routeId) ? '추가됨' : '추가'}
          </button>
        )}
      </li>
    );
  };

  // 필터가 켜져 있으면 그 정류장에 서는 노선만 지도에 그린다.
  // 아직 정류장 목록을 못 받은 노선은 일단 남겨둔다(언마운트되면 영영 못 받으므로).
  const filtering = Boolean(onlyRef && refStop?.arsId);
  const shown = favorites.filter(
    (r) =>
      r.enabled !== false && // 칩에서 끈 노선
      (!filtering ||
        r.routeId === tracked?.routeId || // 추적 중인 노선은 필터와 무관하게 유지
        !routeStops[r.routeId] ||
        routeStops[r.routeId].includes(refStop.arsId)),
  );

  // 하단 카드에 보여줄 버스: 추적 중이면 그 버스(실시간), 아니면 방금 탭한 버스.
  // 복원 직후엔 아직 실시간 정보가 없으므로(live=null) '불러오는 중'으로 표시한다.
  const isTracked = Boolean(tracked);
  const live =
    isTracked && trackStat && trackStat.vehicleNo === tracked.vehicleNo ? trackStat : null;
  const card = isTracked ? { ...tracked, ...(live || {}) } : popup;
  const pending = isTracked && !live;

  return (
    <div className="app">
      <div className="map-stage" ref={stageEl}>
        <div className="map-rot" ref={rotEl}>
          <div ref={mapEl} className="map" />
        </div>
      </div>

      <div className="topbar">
        <form className="search" onSubmit={search}>
          <span className="search__icon" aria-hidden="true">
            <svg viewBox="0 0 20 20" width="18" height="18">
              <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="#7b8394" strokeWidth="2" />
              <path d="M12.8 12.8 L18 18" stroke="#7b8394" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="버스 번호 (예: 273, 마포06)"
            enterKeyHint="search"
          />
          {query && (
            <button
              type="button"
              className="search__clear"
              aria-label="지우기"
              onClick={() => {
                setQuery('');
                setResults(null);
              }}
            >
              ×
            </button>
          )}
          <button type="submit" className="search__go" disabled={searching}>
            {searching ? '…' : '검색'}
          </button>
        </form>

        {filtering && (
          <div className="filterbar">
            <span>
              <b>{refStop.name}</b> 지나는 노선만 표시 중
            </span>
            <button type="button" onClick={() => setOnlyRef(false)}>
              전체 보기
            </button>
          </div>
        )}

        {results && (
          <ul className="results">
            {results.length === 0 && <li className="empty">검색 결과가 없어요</li>}
            {results.map((r) => (
              <li
                key={r.routeId}
                className={has(r.routeId) ? 'is-added' : ''}
                onClick={() => {
                  if (!has(r.routeId)) toggle(r);
                  setResults(null);
                  setQuery('');
                }}
              >
                <span className="no" style={{ background: routeTypeColor(r.routeTp) }}>
                  {r.routeNo}
                </span>
                <span className="ends">
                  {r.start} ↔ {r.end}
                </span>
                <span className="mark">{has(r.routeId) ? '추가됨' : '추가'}</span>
              </li>
            ))}
          </ul>
        )}

        {favorites.length > 0 && (
          <div className="faves">
            {favorites.map((r) => {
              const off = r.enabled === false;
              return (
                <span
                  key={r.routeId}
                  className={`chip${off ? ' chip--off' : ''}`}
                  style={{ '--chip': routeTypeColor(r.routeTp) }}
                >
                  <button
                    className="chip__no"
                    onClick={() => onChip(r)}
                    aria-pressed={!off}
                    title={off ? '지도에 표시' : '지도에서 숨기기'}
                  >
                    {r.routeNo}
                  </button>
                  <button
                    className="chip__x"
                    onClick={() => removeRoute(r)}
                    aria-label={`${r.routeNo} 삭제`}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="bottom">
        {toast && <div className="toast">{toast}</div>}

        <div className="fabs">
          {rotated && !follow && (
            <button className="fab fab--sm" onClick={northUp} aria-label="북쪽으로 정렬">
              N
            </button>
          )}
          {installEvt && (
            <button className="fab fab--sm" onClick={install} aria-label="앱 설치">
              ↓
            </button>
          )}
          <button
            className={`fab${follow ? ' fab--follow' : ''}`}
            onClick={handleFab}
            aria-label="현재 위치"
          >
            ◎
          </button>
        </div>

        {stopPop ? (
          <div className="sheet sheet--scroll">
            <button className="sheet__x" onClick={() => setStopPop(null)} aria-label="닫기">
              ×
            </button>
            <div className="sheet__head">
              <span className="sheet__veh">{stopPop.name || '정류장'}</span>
              {stopPop.arsId && <span className="tag">{stopPop.arsId}</span>}
            </div>

            {walk ? (
              <p className="walk">
                내 위치에서 <b>{walk.meters}m</b> · 걸어서 <b>{spanText(walk.sec)}</b>
                <span className="walk__how">
                  {walk.moving
                    ? `걷는 중 ${walkSpeed.toFixed(1)}m/s 기준`
                    : '평균 보폭 기준 · 실제 동선 감안'}
                </span>
              </p>
            ) : (
              <p className="sheet__note">이 정류장 기준으로 버스가 몇 정거장 전인지 표시해요</p>
            )}

            <button
              type="button"
              className={`sheet__filter${onlyRef ? ' is-on' : ''}`}
              onClick={() => setOnlyRef((v) => !v)}
            >
              {onlyRef ? '전체 노선 다시 보기' : '이 정류장 지나는 노선만 보기'}
            </button>

            {stopPop.loading && <p className="sheet__msg">도착 정보를 불러오는 중…</p>}
            {!stopPop.loading && stopPop.error && (
              <p className="sheet__msg">도착 정보를 불러올 수 없어요.</p>
            )}
            {!stopPop.loading && !stopPop.error && stopPop.arrivals?.length === 0 && (
              <p className="sheet__msg">도착 예정 버스가 없어요.</p>
            )}
            {!stopPop.loading &&
              !stopPop.error &&
              stopPop.arrivals?.length > 0 &&
              [
                ['내 노선', stopPop.arrivals.filter((a) => a.routeId && has(a.routeId))],
                ['그 외 노선', stopPop.arrivals.filter((a) => !(a.routeId && has(a.routeId)))],
              ].map(([label, list]) =>
                list.length === 0 ? null : (
                  <div key={label}>
                    <h3 className="arr__group">{label}</h3>
                    <ul className="arr">{list.map(arrItem)}</ul>
                  </div>
                ),
              )}
          </div>
        ) : card ? (
          <div className={`sheet${isTracked ? ' sheet--live' : ''}`}>
            <button
              className="sheet__x"
              onClick={() => (isTracked ? setTracked(null) : setPopup(null))}
              aria-label="닫기"
            >
              ×
            </button>
            <div className="sheet__head">
              <span className="badge" style={{ background: routeTypeColor(card.routeTp) }}>
                {card.routeNo}
              </span>
              <span className="sheet__veh">{card.vehicleNo}</span>
              {card.lowFloor && <span className="tag">저상</span>}
              {isTracked && <span className="tag tag--live">추적 중</span>}
            </div>

            {pending ? (
              <p className="lead lead--dim">버스 위치를 불러오는 중…</p>
            ) : card.dest?.notOnRoute ? (
              <p className="lead lead--dim">이 버스는 {card.dest.name} 에 서지 않아요</p>
            ) : card.dest?.passed ? (
              <p className="lead lead--dim">{card.dest.name} 이미 지나갔어요</p>
            ) : card.dest?.stopsAway === 0 ? (
              <p className="lead lead--now">
                <b>{card.dest.name}</b> 도착 — 지금 타세요
              </p>
            ) : card.dest ? (
              <p className="lead">
                <b>{card.dest.stopsAway}</b>정거장 전 · <b>{minText(card.dest.etaSec)}</b>
                <span className="lead__sub">
                  {card.dest.name}까지 {card.dest.meters}m
                  <button type="button" className="lead__clear" onClick={() => setRefStop(null)}>
                    기준 해제
                  </button>
                </span>
              </p>
            ) : (
              <p className="lead lead--dim">
                기다리는 정류장을 지도에서 탭하면 몇 정거장 전인지 알려줘요
              </p>
            )}

            {!pending && (
              <div className="meta">
                <span className={card.stopFlag === 1 ? 'meta--stop' : ''}>
                  {card.stopFlag === 1
                    ? '정류장 정차 중'
                    : card.moving
                      ? `운행 중 ${card.speedKmh}km/h`
                      : '신호 대기'}
                </span>
                {card.nextStopName && (
                  <span>
                    다음 {card.nextStopName}
                    {card.nextStopMeters != null && ` ${card.nextStopMeters}m`}
                    {card.nextStopSec != null && ` · ${spanText(card.nextStopSec)}`}
                  </span>
                )}
                {CONGESTION[card.congestion] && <span>{CONGESTION[card.congestion]}</span>}
                {agoText(card.dataTm) && (
                  <span className="meta__ago">{agoText(card.dataTm)} 정보</span>
                )}
              </div>
            )}

            <div className="acts">
              {isTracked ? (
                <>
                  {!centering && (
                    <button className="btn btn--primary" onClick={() => setCentering(true)}>
                      버스로 이동
                    </button>
                  )}
                  <button className="btn btn--ghost" onClick={() => setTracked(null)}>
                    추적 해제
                  </button>
                </>
              ) : (
                <button className="btn btn--primary" onClick={() => startTrack(card)}>
                  이 버스 추적하기
                </button>
              )}
            </div>
          </div>
        ) : refStop ? (
          <div className="sheet sheet--walk">
            <button className="sheet__x" onClick={() => setRefStop(null)} aria-label="기준 해제">
              ×
            </button>
            {/* 탭하면 그 정류장으로 지도를 옮기고 도착정보를 연다(지도 아이콘 탭과 동일) */}
            <div
              className="sheet__open"
              role="button"
              tabIndex={0}
              onClick={() => openStop(refStop, true)}
              onKeyDown={(e) => e.key === 'Enter' && openStop(refStop, true)}
            >
              <div className="sheet__head">
                <span className="sheet__veh">{refStop.name}</span>
                <span className="tag">기준 정류장</span>
                {filtering && <span className="tag tag--live">경유 노선만</span>}
              </div>
              {walk ? (
                <p className="walk">
                  내 위치에서 <b>{walk.meters}m</b> · 걸어서 <b>{spanText(walk.sec)}</b>
                  <span className="walk__how">
                    {walk.moving
                      ? `걷는 중 ${walkSpeed.toFixed(1)}m/s 기준`
                      : '평균 보폭 기준 · 실제 동선 감안'}
                  </span>
                </p>
              ) : (
                <p className="walk__how">탭하면 이 정류장 도착 정보를 봅니다</p>
              )}
            </div>
          </div>
        ) : favorites.length === 0 ? (
          <div className="sheet sheet--hint">
            <b>버스 번호를 검색해 추가해 보세요.</b>
            <span>
              추가한 노선 칩을 탭하면 나에게 오고 있는 가장 가까운 버스를 바로 따라갑니다.
            </span>
          </div>
        ) : null}
      </div>

      {map && (
        <StopsLayer
          map={map}
          onStopClick={onStopClick}
          pickedArsId={refStop?.arsId || null}
        />
      )}

      {map &&
        shown.map((r) => (
          <ErrorBoundary key={r.routeId} fallback={null}>
            <RouteLayer
              map={map}
              route={r}
              onStops={onRouteStops}
              bus={{
                onBusClick,
                onTrackStat,
                onTrackLost,
                refStop,
                trackCentering: centering,
                trackedVehicleNo:
                  tracked && tracked.routeId === r.routeId ? tracked.vehicleNo : null,
                selectedVehicleNo:
                  popup && popup.routeId === r.routeId ? popup.vehicleNo : null,
                // 필터가 켜진 동안에만 "이 정류장 몇 분 후 도착" 배지를 붙인다
                etaStop: filtering ? refStop : null,
                walkSec: walk?.sec ?? null,
              }}
            />
          </ErrorBoundary>
        ))}
    </div>
  );
}
