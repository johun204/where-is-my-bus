import { useEffect, useRef, useState } from 'react';
import { useFavoriteRoutes } from './hooks/useFavoriteRoutes';
import { RouteLayer } from './map/RouteLayer';
import { routeTypeColor } from './map/routeColor';

const FALLBACK = { lat: 37.5665, lng: 126.978 }; // 서울시청 (위치 권한 거부 시)
const GEO_OPTS = { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 };

export default function App() {
  const mapEl = useRef(null);
  const [map, setMap] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [installEvt, setInstallEvt] = useState(null);
  const myRef = useRef(null); // 현위치 오버레이
  const { favorites, has, toggle } = useFavoriteRoutes();

  useEffect(() => {
    window.kakao.maps.load(() => {
      setMap(
        new window.kakao.maps.Map(mapEl.current, {
          center: new window.kakao.maps.LatLng(FALLBACK.lat, FALLBACK.lng),
          level: 4,
        }),
      );
    });
  }, []);

  // 첫 진입 시 현재 위치로 이동
  useEffect(() => {
    if (!map || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => showMyLocation(p.coords.latitude, p.coords.longitude, true),
      () => {}, // 거부 시 서울시청 유지
      GEO_OPTS,
    );
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  // PWA 설치 프롬프트 캡처 (Android/데스크톱 Chrome)
  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setInstallEvt(e);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  function showMyLocation(lat, lng, center) {
    const { kakao } = window;
    const ll = new kakao.maps.LatLng(lat, lng);
    if (!myRef.current) {
      const el = document.createElement('div');
      el.className = 'myloc';
      myRef.current = new kakao.maps.CustomOverlay({
        map,
        position: ll,
        content: el,
        zIndex: 9,
      });
    } else {
      myRef.current.setPosition(ll);
    }
    if (center) map.panTo(ll);
  }

  function locate() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => showMyLocation(p.coords.latitude, p.coords.longitude, true),
      () => alert('현재 위치를 가져올 수 없어요. 위치 권한을 확인해 주세요.'),
      GEO_OPTS,
    );
  }

  async function search(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const r = await fetch(`/api/route?routeNo=${encodeURIComponent(q)}`);
      setResults((await r.json()).results ?? []);
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

  return (
    <div className="app">
      <div ref={mapEl} className="map" />

      <div className="topbar">
        <form className="search" onSubmit={search}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="버스 번호 검색"
            inputMode="numeric"
          />
          <button type="submit" disabled={searching}>
            {searching ? '…' : '검색'}
          </button>
          {installEvt && (
            <button type="button" className="install" onClick={install}>
              설치
            </button>
          )}
        </form>

        {results && (
          <ul className="results">
            {results.length === 0 && <li className="empty">검색 결과 없음</li>}
            {results.map((r) => (
              <li key={r.routeId}>
                <span className="dot" style={{ background: routeTypeColor(r.routeTp) }} />
                <span className="no">{r.routeNo}</span>
                <span className="ends">
                  {r.start} ↔ {r.end}
                </span>
                <button onClick={() => toggle(r)}>{has(r.routeId) ? '삭제' : '추가'}</button>
              </li>
            ))}
          </ul>
        )}

        {favorites.length > 0 && (
          <div className="faves">
            {favorites.map((r) => (
              <span
                key={r.routeId}
                className="chip"
                style={{ borderColor: routeTypeColor(r.routeTp) }}
              >
                {r.routeNo}
                <button onClick={() => toggle(r)} aria-label="삭제">
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <button className="fab" onClick={locate} aria-label="현재 위치">
        ◎
      </button>

      {map && favorites.map((r) => <RouteLayer key={r.routeId} map={map} route={r} />)}
    </div>
  );
}
