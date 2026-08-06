/**
 * Historical price data loaders for the backtester.
 *
 * Two sources are supported:
 *  - a local CSV file (date,open,high,low,close,volume)
 *  - Alpha Vantage's TIME_SERIES_DAILY_ADJUSTED REST endpoint
 *
 * Neither path executes trades; they only read historical bars.
 */

import type { Bar } from "./types.ts";

const ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query";

export function parseCsv(csv: string): Bar[] {
  const lines = csv.trim().split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const col = (name: string): number => {
    const idx = header.indexOf(name);
    if (idx === -1) throw new Error(`CSV is missing required column "${name}"`);
    return idx;
  };

  const dateCol = col("date");
  const openCol = col("open");
  const highCol = col("high");
  const lowCol = col("low");
  const closeCol = col("close");
  const volumeCol = col("volume");

  const bars: Bar[] = lines.slice(1).map((line) => {
    const cells = line.split(",");
    return {
      date: cells[dateCol].trim(),
      open: Number(cells[openCol]),
      high: Number(cells[highCol]),
      low: Number(cells[lowCol]),
      close: Number(cells[closeCol]),
      volume: Number(cells[volumeCol]),
    };
  });

  return bars.sort((a, b) => a.date.localeCompare(b.date));
}

export async function loadBarsFromCsvFile(path: string): Promise<Bar[]> {
  const csv = await Deno.readTextFile(path);
  return parseCsv(csv);
}

interface AlphaVantageDailyResponse {
  "Time Series (Daily)"?: Record<string, {
    "1. open": string;
    "2. high": string;
    "3. low": string;
    "4. close": string;
    "6. volume": string;
  }>;
  "Note"?: string;
  "Error Message"?: string;
  "Information"?: string;
}

/**
 * Fetch daily adjusted bars for `symbol` from Alpha Vantage.
 * Requires an API key, either passed explicitly or via ALPHAVANTAGE_API_KEY.
 */
export async function fetchAlphaVantageDailyBars(
  symbol: string,
  apiKey: string | undefined = Deno.env.get("ALPHAVANTAGE_API_KEY"),
  outputSize: "compact" | "full" = "compact",
): Promise<Bar[]> {
  if (!apiKey) {
    throw new Error(
      "Alpha Vantage API key is required. Pass one explicitly or set ALPHAVANTAGE_API_KEY.",
    );
  }

  const url = new URL(ALPHA_VANTAGE_BASE_URL);
  url.searchParams.set("function", "TIME_SERIES_DAILY_ADJUSTED");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("outputsize", outputSize);
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Alpha Vantage request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as AlphaVantageDailyResponse;

  if (payload["Error Message"]) throw new Error(payload["Error Message"]);
  if (payload["Note"]) throw new Error(`Alpha Vantage rate limit: ${payload["Note"]}`);
  if (payload["Information"]) throw new Error(payload["Information"]);

  const series = payload["Time Series (Daily)"];
  if (!series) throw new Error(`No time series data returned for symbol "${symbol}"`);

  const bars: Bar[] = Object.entries(series).map(([date, values]) => ({
    date,
    open: Number(values["1. open"]),
    high: Number(values["2. high"]),
    low: Number(values["3. low"]),
    close: Number(values["4. close"]),
    volume: Number(values["6. volume"]),
  }));

  return bars.sort((a, b) => a.date.localeCompare(b.date));
}
