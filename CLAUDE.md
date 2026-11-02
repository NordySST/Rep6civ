# CLAUDE.md — Rep6civ

Jogo 4X de estratégia por turnos **original** (nomes, civilizações, líderes, maravilhas e arte
inventados), inspirado na profundidade de jogos como Civilization VI. Interface em **pt-BR**,
jogável por toque, instalável como PWA e offline.

## Comandos

```bash
npm install
npm run dev        # servidor de desenvolvimento (Vite)
npm test           # testes (Vitest)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + build de produção em dist/
npm run preview    # serve dist/ (necessário para testar o service worker)
node scripts/make-icons.mjs   # regenera os PNGs do PWA a partir de public/icons/icon.svg
```

Deploy: `.github/workflows/deploy.yml` roda testes + build e publica `dist/` no GitHub Pages
a cada push em `main` (e nos branches `claude/**`). O `base` do Vite é relativo (`./`), então o
site funciona em qualquer subcaminho (`https://<usuário>.github.io/Rep6civ/`).
Pré-requisito (uma vez): Settings → Pages → Source = **GitHub Actions**.

## Arquitetura

```
src/
  data/    Definições de conteúdo (terrenos, características, recursos, maravilhas, unidades,
           civilizações, tamanhos de mapa, rendimentos). Só dados tipados, sem lógica.
  state/   Tipos do estado serializável (types.ts), versão do esquema (version.ts) e
           salvar/carregar com migrações (save.ts).
  rules/   Regras PURAS, sem DOM: hex.ts (geometria), rng.ts/noise.ts (aleatoriedade com semente),
           mapgen.ts (geração procedural), tiles.ts (consultas/rendimentos), movement.ts
           (custos, A*, alcance), visibility.ts (névoa), city.ts, game.ts (novo jogo),
           actions.ts (redutor de ações + fim de turno).
  render/  Canvas 2D: camera.ts (transformações/zoom) e renderer.ts (arte procedural).
  ui/      DOM/HUD: app.ts (controlador), input.ts (toque/pinça/arrastar/roda),
           menus.ts (novo jogo, salvar/carregar), strings.ts (todos os textos pt-BR), dom.ts.
  ai/      IA dos rivais (stub até a etapa 5).
  main.ts  Ponto de entrada; registra o service worker em produção.
public/    manifest.webmanifest, sw.js (offline), ícones.
tests/     Vitest para as regras (hex, rng, mapgen, jogo/movimento/névoa, save).
```

### Convenções

- **Estado = JSON puro.** Nada de classes, `Map` ou `Set` no `GameState`. Posições são
  **índices** `idx = row * width + col`.
- **Regras puras.** `applyAction(state, action)` clona o estado (`structuredClone`) e devolve
  `{ state, events }`; nunca muta a entrada. Funções internas que mutam (ex.: `foundCity`,
  `endTurn`, `revealForPlayer`) trabalham sobre esse rascunho clonado e estão documentadas.
- **Determinismo.** Toda aleatoriedade de regras usa `createRng(semente)`; nunca `Math.random`
  dentro de `rules/`. A mesma semente + tamanho geram o mesmo mapa (testado).
- **Dados separados da lógica.** Novo conteúdo (unidade, recurso, maravilha…) entra em
  `src/data/` e as regras o leem genericamente.
- **Textos** da UI ficam em `src/ui/strings.ts` (pt-BR). Nomes de conteúdo ficam nos dados.
- **render/ e ui/ não alteram o estado**: só despacham ações.
- **Hexágonos:** pointy-top, offset "odd-r". Direções/arestas: 0=L, 1=SE, 2=SO, 3=O, 4=NO, 5=NE.
  Aresta i fica entre os cantos i e i+1; a aresta i de A é a (i+3)%6 do vizinho. Rios são uma
  máscara de 6 bits por hexágono, sempre gravada dos dois lados (`setRiverEdge`).
- **Mapa sem wrap** horizontal (decisão da etapa 1; pode ser revista).
- **Saves:** envelope `{ format, version, savedAt, meta, state }` em `localStorage`
  (`rep6civ.save.<slot>`; slots `auto`, `slot1..3`). Ao mudar o formato: incremente
  `SCHEMA_VERSION`, adicione `MIGRATIONS[versãoAnterior]` e um teste em `tests/save.test.ts`.
- **Toque primeiro:** botões ≥ 44px, `touch-action: none` no canvas, layout retrato e paisagem
  (media queries em `styles.css`), respeito a `safe-area-inset`.
- **Testes:** toda regra nova em `rules/` ganha teste em `tests/`. Rodar `npm test` e
  `npm run build` antes de cada commit.

### Regras implementadas (resumo)

- Movimento: custo base 1; +1 colinas; +1 floresta/selva/pântano; montanha, água e algumas
  maravilhas são intransitáveis; cruzar rio consome todo o movimento; pode-se sempre entrar com
  qualquer movimento restante. Empilhamento: 1 militar + 1 civil por hexágono.
- Rotas de vários turnos ficam em `unit.path` e continuam automaticamente no fim do turno.
- Visão: unidades 2 (+1 em colinas), cidades 3; montanhas, colinas, florestas e selvas
  bloqueiam a linha de visão (observador em colinas só é bloqueado por montanhas).
- Cidade: só colono; terra transitável; distância mínima 4 de outra cidade; território raio 1;
  primeira cidade é a capital; remove floresta/selva/pântano do centro.
- Calendário: turno 1 = 4000 a.C., +40 anos por turno (provisório).

## Plano das 8 etapas

1. **[CONCLUÍDA] Fundação** — mapa hexagonal procedural com semente (pequeno/médio/grande),
   terrenos, colinas, floresta/selva/pântano, rios nas arestas, recursos bônus/luxo/estratégicos,
   maravilhas naturais; névoa de guerra; câmera (arrastar, pinça, +/−); salvar/carregar com
   versionamento e migração; colono e guerreiro; fundar cidade; próximo turno; PWA + deploy.
2. **Cidades e território** — crescimento populacional, comida/produção, trabalho de hexágonos,
   fila de produção (unidades e edifícios), expansão cultural de fronteiras, compra de hexágonos,
   construtores e melhorias (fazenda, mina, pastagem…), estradas, painel da cidade.
3. **Ciência e cultura** — árvore de tecnologias e de cívicas, revelação de recursos estratégicos
   (`revealedBy`), governos e cartas de política, eurekas/inspirações.
4. **Combate** — força, dano, ZOC, bônus de terreno/rio/fortificação, unidades à distância,
   promoções, acampamentos bárbaros, captura de cidades, muralhas.
5. **IA e diplomacia** — civilizações rivais (`src/ai`), múltiplos jogadores no turno,
   primeiro contato, guerra/paz, acordos, agendas dos líderes, cidades-estado.
6. **Distritos e maravilhas** — distritos especializados com bônus de adjacência, edifícios,
   maravilhas mundiais, habilidades únicas das civilizações (já descritas em `data/civs.ts`).
7. **Economia e sociedade** — ouro/manutenção, amenidades e recursos de luxo, comércio e rotas,
   religião/fé, grandes personagens, unidades navais e exploração marítima.
8. **Vitória e polimento** — condições de vitória (dominação, ciência, cultura, religião,
   pontuação), eras, tutorial, áudio, animações, acessibilidade, balanceamento e desempenho.

## Registro por etapa

### Etapa 1 (concluída)
- Estrutura do projeto, dados, gerador de mapas (fBm + núcleos continentais, nível do mar por
  percentil, clima por latitude/umidade, rios por descida de vértices, maravilhas e recursos).
- Renderizador canvas com arte procedural (sem imagens externas), névoa em 2 níveis
  (inexplorado / explorado-não-visível), fronteiras, rotas com contagem de turnos.
- UI de toque: toque seleciona unidade; toque num destino mostra a rota; segundo toque confirma.
  "Próxima unidade" percorre unidades sem ordens; "Próximo turno" quando todas agiram.
- Salvamento automático a cada turno e ao fundar cidade; 3 espaços manuais.
- Opção de depuração "Revelar mapa" no menu.
- Pendências conhecidas: recursos estratégicos aparecem desde o início (serão ocultados pela
  tecnologia na etapa 3); sem IA/rivais ainda; sem animações de movimento.
