/**
 * Centralized presets and catalog for SCARline simulators and environment.
 */

// ─── CARLA Weather Presets ──────────────────────────────────────────────────
// These match the official CARLA weather presets available via the Python API
// and are displayed in the Admin Panel for selection.
export const weatherPresets = [
  'ClearNoon',
  'ClearSunset',
  'CloudyNoon',
  'CloudySunset',
  'WetNoon',
  'WetSunset',
  'HardRainNoon',
  'HardRainSunset',
  'SoftRainNoon',
  'SoftRainSunset',
  'MidRainSunset',
  'MidRainyNoon'
] as const;

export type WeatherPreset = typeof weatherPresets[number];

/**
 * Validates if a string is a known CARLA weather preset.
 */
export function isValidWeatherPreset(value: string): value is WeatherPreset {
  return (weatherPresets as readonly string[]).includes(value);
}
