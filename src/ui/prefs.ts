/** Preferências do aparelho (localStorage), independentes do save. */
export interface Prefs {
  sound: boolean;
  tips: boolean;
  animations: boolean;
  largeText: boolean;
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
  const def: Prefs = { sound: true, tips: true, animations: !reducedMotion(), largeText: false, seenTips: [] };
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
