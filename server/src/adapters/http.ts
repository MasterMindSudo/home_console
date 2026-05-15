import fetch from "node-fetch";

export async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T> {
  const response = await fetch(url, { timeout: timeoutMs });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}
