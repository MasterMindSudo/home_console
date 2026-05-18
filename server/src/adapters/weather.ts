import { SourceStatus, WeatherHour } from "../../../shared/types";
import { fetchJson } from "./http";

interface OpenMeteoHourly {
  time?: string[];
  temperature_2m?: number[];
  relative_humidity_2m?: number[];
  precipitation?: number[];
}

interface OpenMeteoResponse {
  hourly?: OpenMeteoHourly;
}

interface WeatherResult {
  status: SourceStatus;
  hours: WeatherHour[];
}

const HONG_KONG_COORDINATES = { lat: 22.3027, lng: 114.1772 };

function localWeatherTime(value: string): string {
  return `${value}+08:00`;
}

export async function getHourlyWeather(): Promise<WeatherResult> {
  const params = new URLSearchParams({
    latitude: String(HONG_KONG_COORDINATES.lat),
    longitude: String(HONG_KONG_COORDINATES.lng),
    timezone: "Asia/Hong_Kong",
    forecast_days: "1",
    hourly: "temperature_2m,relative_humidity_2m,precipitation"
  });

  try {
    const payload = await fetchJson<OpenMeteoResponse>(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, 10000);
    const hourly = payload.hourly || {};
    const now = Date.now();
    const hours = (hourly.time || [])
      .map((time, index) => ({
        time: localWeatherTime(time),
        temperatureC: Math.round(hourly.temperature_2m?.[index] ?? 0),
        humidityPercent: Math.round(hourly.relative_humidity_2m?.[index] ?? 0),
        precipitationMm: Number((hourly.precipitation?.[index] ?? 0).toFixed(1))
      }))
      .filter((item) => new Date(item.time).getTime() >= now - 30 * 60000)
      .slice(0, 8);

    return {
      status: { health: "ok", updatedAt: new Date().toISOString() },
      hours
    };
  } catch (error) {
    return {
      status: { health: "error", updatedAt: new Date().toISOString(), message: error instanceof Error ? error.message : "Weather forecast failed." },
      hours: []
    };
  }
}
