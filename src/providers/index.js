import { config } from '../config.js';
import { claro } from './claro.js';
import { tim } from './tim.js';
import { nio } from './nio.js';

const ALL = { claro, tim, nio };

/** Providers ligados via PROVIDERS no .env (ex.: "claro" ou "claro,tim,nio"). */
export function getEnabledProviders() {
  return config.enabledProviders.map((k) => ALL[k]).filter(Boolean);
}

export function getProvider(key) {
  return ALL[key?.toLowerCase()];
}
