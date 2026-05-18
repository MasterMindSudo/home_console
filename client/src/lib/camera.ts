import { useEffect, useState } from "react";

const CAMERA_REFRESH_MS = 2 * 60 * 1000;
const CAMERA_ROTATE_MS = 5 * 1000;

function cameraBucket(now = Date.now()): number {
  return Math.floor(now / CAMERA_REFRESH_MS);
}

export function useCameraRefreshToken(): number {
  const [token, setToken] = useState(() => cameraBucket());

  useEffect(() => {
    const refresh = () => setToken(cameraBucket());
    const delay = CAMERA_REFRESH_MS - (Date.now() % CAMERA_REFRESH_MS) + 250;
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      refresh();
      interval = window.setInterval(refresh, CAMERA_REFRESH_MS);
    }, delay);
    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) {
        window.clearInterval(interval);
      }
    };
  }, []);

  return token;
}

export function cameraImageUrl(url: string, token: number): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${token}`;
}

export function useRotatingIndex(count: number): number {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (count <= 1) return;
    const interval = window.setInterval(() => {
      setIndex((current) => (current + 1) % count);
    }, CAMERA_ROTATE_MS);
    return () => window.clearInterval(interval);
  }, [count]);

  return count ? Math.min(index, count - 1) : 0;
}
