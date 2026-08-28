import { useCallback, useEffect, useState } from 'react';

const KEY = 'busmap.favorites.v1';

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(v) ? v : [];
  } catch {
    return []; // 손상된 값은 무시하고 초기화
  }
}

/**
 * 즐겨찾기 버스 노선 목록을 localStorage에 영속화.
 * route 형태: { routeId, routeNo, routeTp, cityCode }
 */
export function useFavoriteRoutes() {
  const [favorites, setFavorites] = useState(load);

  // 변경 시마다 저장
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(favorites));
  }, [favorites]);

  // 다른 탭에서 바꾸면 동기화
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === KEY) setFavorites(load());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const has = useCallback(
    (routeId) => favorites.some((r) => r.routeId === routeId),
    [favorites],
  );

  const toggle = useCallback((route) => {
    setFavorites((prev) =>
      prev.some((r) => r.routeId === route.routeId)
        ? prev.filter((r) => r.routeId !== route.routeId)
        : [...prev, route],
    );
  }, []);

  const remove = useCallback((routeId) => {
    setFavorites((prev) => prev.filter((r) => r.routeId !== routeId));
  }, []);

  return { favorites, has, toggle, remove };
}
