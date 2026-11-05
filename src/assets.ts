import { useSyncExternalStore } from 'react';
import { persona } from './game/personas';

export type HostPose = 'idle' | 'listening' | 'correct' | 'incorrect';
export type SoundName = 'clap' | 'correct' | 'buzzer' | 'stinger';

interface AssetMap {
  host: Partial<Record<HostPose, string>>;
  sounds: Partial<Record<SoundName, string>>;
  personas: Record<string, string>;
  logo: string | null;
}

let assets: AssetMap = { host: {}, sounds: {}, personas: {}, logo: null };
const listeners = new Set<() => void>();

export async function loadAssets(): Promise<AssetMap> {
  try {
    const r = await fetch('/api/assets');
    if (r.ok) {
      const data = (await r.json()) as Partial<AssetMap>;
      assets = {
        host: data.host ?? {},
        sounds: data.sounds ?? {},
        personas: data.personas ?? {},
        logo: data.logo ?? null,
      };
      listeners.forEach((l) => l());
    }
  } catch (err) {
    console.warn('Asset list unavailable, using built-in placeholders', err);
  }
  return assets;
}

export function hostImage(pose: HostPose): string {
  return assets.host[pose] ?? `/host/${pose}.png`;
}

export function personaImage(id: string): string {
  return assets.personas[id] ?? persona(id).image;
}

export function soundOverride(name: SoundName): string | undefined {
  return assets.sounds[name];
}

export function useAssets(): AssetMap {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => assets,
  );
}
