/** Preferências do aparelho (localStorage), independentes do save. */
export interface Prefs {
  sound: boolean;
  /** Trilha sonora generativa. */
  music: boolean;
  /** Volumes (0–1) dos efeitos e da música. */
  sfxVol: number;
  musicVol: number;
  tips: boolean;
  animations: boolean;
  largeText: boolean;
  /** Mapa em 3D (WebGL); sem suporte, o jogo usa o 2D. */
  view3d: boolean;
  /** Gráficos 3D em alta qualidade (sombras, água e nuvens animadas); `undefined` = pelo aparelho. */
  hq3d?: boolean;
  /** Jogadas de rivais e bárbaros mostradas uma a uma, com a câmera acompanhando. */
  watchAi?: boolean;
  seenTips: string[];
}

const KEY = 'rep6civ.prefs';

function reducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

export function loadPrefs(): Prefs {
  const def: Prefs = { sound: true, music: true, sfxVol: 0.8, musicVol: 0.5, tips: true, animations: !reducedMotion(), largeText: false, view3d: true, seenTips: [] };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...def, ...JSON.parse(raw) };
  } catch {
    /* sem armazenamento: usa padrões */
  }
  return def;
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignora */
  }
}

export function applyPrefs(p: Prefs): void {
  document.documentElement.classList.toggle('large-text', p.largeText);
}
