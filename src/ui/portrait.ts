import { CIV_BY_ID } from '../data/civs';
import { portraitUrl } from '../data/leaders';
import { h } from './dom';

/** Retrato pequeno do líder (imagem pré-renderizada; some se o arquivo faltar). */
export function portrait(civId: string, size: 'sm' | 'md' | 'lg' = 'sm'): HTMLElement {
  const civ = CIV_BY_ID[civId];
  const img = h('img', {
    class: `portrait ${size}`,
    src: portraitUrl(civId),
    alt: civ ? `${civ.leaderTitle} ${civ.leader}` : '',
    loading: 'lazy',
    decoding: 'async',
    style: civ ? `--civ:${civ.color};--civ2:${civ.secondaryColor}` : '',
  }) as HTMLImageElement;
  img.onerror = () => img.classList.add('missing');
  return img;
}
