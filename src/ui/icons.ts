/**
 * Ícones vetoriais próprios do jogo (SVG inline, sem arquivos externos). Desenhados numa
 * grade 24×24, preenchidos com `currentColor` (a cor vem do CSS). Substituem os emojis,
 * que mudam de aparência em cada aparelho.
 */

const P: Record<string, string> = {
  // rendimentos
  food: 'M12 2c1.5 3 1.5 5 0 7-1.5-2-1.5-4 0-7zm-5 6c2.5 1 3.6 2.8 3.4 5.3C8 12.4 7 10.6 7 8zm10 0c0 2.6-1 4.4-3.4 5.3-.2-2.5.9-4.3 3.4-5.3zM7 14c2.5 1 3.6 2.8 3.4 5.3C8 18.4 7 16.6 7 14zm10 0c0 2.6-1 4.4-3.4 5.3-.2-2.5.9-4.3 3.4-5.3zM11 10h2v12h-2z',
  production: 'M14.5 3l6.5 6.5-2.2 2.2-1.6-1.6-6.8 6.8 1.6 1.6L9.8 20.7 3.3 14.2l2.2-2.2 1.6 1.6 6.8-6.8-1.6-1.6zM4 20l3-3 1 1-3 3z',
  gold: 'M12 3a9 9 0 110 18 9 9 0 010-18zm0 2.2a6.8 6.8 0 100 13.6 6.8 6.8 0 000-13.6zM11 7h2v1.2c1.4.3 2.4 1.2 2.5 2.5h-2c-.1-.5-.6-.8-1.5-.8-1 0-1.4.4-1.4.9 0 .6.6.8 1.8 1.1 1.8.4 3.2 1 3.2 2.8 0 1.3-1 2.3-2.6 2.6V18h-2v-1.2c-1.6-.3-2.7-1.3-2.8-2.8h2c.1.7.7 1.1 1.8 1.1s1.6-.4 1.6-1c0-.6-.6-.9-1.9-1.2-1.7-.4-3.1-1-3.1-2.7 0-1.3.9-2.2 2.4-2.5z',
  science: 'M9 2h6v2h-1v5.2l5.6 9.4A2 2 0 0117.9 22H6.1a2 2 0 01-1.7-3.4L10 9.2V4H9zm3 9.4L8.3 17.7h7.4z',
  culture: 'M4 4h16v6a8 8 0 01-16 0zm3.5 4a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm9 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM8 13.5c1 1.7 2.4 2.5 4 2.5s3-.8 4-2.5z',
  faith: 'M12 2l2.6 6.4L21 9l-5 4.4L17.5 20 12 16.6 6.5 20 8 13.4 3 9l6.4-.6z',
  housing: 'M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z',
  amenity: 'M12 21s-8-5.3-8-11a4.6 4.6 0 018-3 4.6 4.6 0 018 3c0 5.7-8 11-8 11z',
  // categorias de liberação
  unit: 'M7 3h10l-1 6 3 2v4l-3 1v5h-3v-5h-2v5H8v-5l-3-1v-4l3-2z',
  building: 'M3 21V10l9-6 9 6v11h-6v-6H9v6zm6-12h6v2H9z',
  district: 'M3 21V8l5-3 5 3v13zm11 0V11l4-2 3 2v10zM5 10h6v2H5zm0 4h6v2H5zm11 0h3v2h-3z',
  improvement: 'M4 18h16v3H4zM6 6l3 9H6.5L4 9zm6-3l2.5 12h-2.6L11 6zm6 3l-2.5 9H18l2-6z',
  resource: 'M12 2l7 7-7 13L5 9zm0 3.4L8 9h8z',
  wonder: 'M12 2l1.8 4 4.2.4-3.2 2.8 1 4.1L12 11.2 8.2 13.3l1-4.1L6 6.4l4.2-.4zM5 15h14l1 2H4zm-1 3h16v3H4z',
  project: 'M12 2c3 2 4.5 5 4.5 9v5l2 3H5.5l2-3v-5c0-4 1.5-7 4.5-9zm0 6a2 2 0 100 4 2 2 0 000-4zM10 20h4l-2 3z',
  government: 'M12 2l9 5v2H3V7zM5 10h2v8H5zm4 0h2v8H9zm4 0h2v8h-2zm4 0h2v8h-2zM3 19h18v3H3z',
  policy: 'M6 2h9l5 5v15H6zm8 1.5V8h4.5zM8.5 11h9v1.8h-9zm0 3.5h9v1.8h-9zm0 3.5h6v1.8h-6z',
  // árvore e ações
  tech: 'M12 2a7 7 0 014.2 12.6c-.6.5-1.2 1.4-1.2 2.4v1H9v-1c0-1-.6-1.9-1.2-2.4A7 7 0 0112 2zM9 19h6v2H9zm1 2.5h4V23h-4z',
  civic: 'M12 2l2 4 4.5.6-3.2 3.1.8 4.4L12 12l-4.1 2.1.8-4.4L5.5 6.6 10 6zM4 16h16v2H4zm2 3h12v3H6z',
  boost: 'M13 2L4 14h7l-1 8 9-12h-7z',
  check: 'M9 16.2l-4.2-4.2L3.4 13.4 9 19 21 7l-1.4-1.4z',
  lock: 'M7 10V7a5 5 0 0110 0v3h1.5v12h-13V10zm2 0h6V7a3 3 0 00-6 0z',
  target: 'M12 2a10 10 0 110 20 10 10 0 010-20zm0 3a7 7 0 100 14 7 7 0 000-14zm0 3a4 4 0 110 8 4 4 0 010-8zm0 2.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z',
  diplomacy: 'M2 11l4-4 3 1 3-2 3 2 3-1 4 4-3 3-2-1-4 4a1.5 1.5 0 01-2.1 0L9 16.2l-1.6 1.6a1.4 1.4 0 01-2-2L7 14.2 5 13zm7.3 2.2l3.3 3.3 3.6-3.6-2.9-2.9-1.6 1L9.6 10z',
  menu: 'M3 5h18v2.5H3zm0 5.75h18v2.5H3zM3 16.5h18V19H3z',
  turns: 'M12 2a10 10 0 110 20 10 10 0 010-20zm0 2a8 8 0 100 16 8 8 0 000-16zm-1 3h2v5.2l4 2.4-1 1.7-5-3z',
};

export type IconName = keyof typeof P;

export function iconSvg(name: string, cls = ''): string {
  const d = P[name] ?? P.resource;
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
}

/** Elemento <span> com o ícone (para usar com `h`). */
export function icon(name: string, cls = ''): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = `icw ${cls}`.trim();
  s.innerHTML = iconSvg(name);
  return s;
}
