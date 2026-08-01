// Weather forecast provider backed by Open-Meteo (free, no API key). Domes
// and closed-roof retractables should skip this call entirely — see
// weeklyUpdate.js, which checks stadium.roof before fetching.

export async function fetchGameWeather({ lat, lon, kickoffIso }) {
  const date = kickoffIso.slice(0, 10);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,precipitation_probability,wind_speed_10m` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&start_date=${date}&end_date=${date}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status} ${res.statusText}`);
  const json = await res.json();

  const hours = json.hourly?.time ?? [];
  const targetHour = kickoffIso.slice(0, 13); // YYYY-MM-DDTHH
  let idx = hours.findIndex((h) => h.startsWith(targetHour));
  if (idx === -1) idx = Math.floor(hours.length / 2); // fallback: midday if exact hour missing

  return {
    isDome: false,
    tempF: json.hourly.temperature_2m[idx],
    windMph: json.hourly.wind_speed_10m[idx],
    precipProbPct: json.hourly.precipitation_probability[idx],
  };
}
