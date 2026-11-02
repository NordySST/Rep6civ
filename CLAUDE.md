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
           edifícios, melhorias, tecnologias, cívicas, governos/políticas, eurecas, promoções, distritos,
           maravilhas mundiais, cidades-estado,
           civilizações, tamanhos de mapa, rendimentos). Só dados tipados.
  state/   Tipos do estado serializável (types.ts), versão do esquema (version.ts) e
           salvar/carregar com migrações (save.ts).
  rules/   Regras PURAS, sem DOM: hex.ts (geometria), rng.ts/noise.ts (aleatoriedade com semente),
           mapgen.ts (geração procedural), tiles.ts (consultas/rendimentos), movement.ts
           (custos, A*, alcance, estradas), visibility.ts (névoa), city.ts (fundar),
           cities.ts (gestão: rendimentos, cidadãos, crescimento, moradia, produção, cultura,
           fronteiras, compras), builders.ts (melhorias, estradas, remoção de características),
           research.ts (tecnologias, cívicas, eurecas/inspirações), effects.ts (governo,
           políticas e agregação de modificadores), combat.ts (força, dano, ataques, ZOC,
           cidades, cura, promoções), barbarians.ts (acampamentos e comportamento bárbaro —
           NPC determinístico, fica em rules/; a IA de civilizações rivais fica em ai/),
           districts.ts (distritos, adjacência, maravilhas mundiais, habilidades únicas),
           diplomacy.ts (contato, guerra/paz, acordos, opinião/agendas, emissários,
           suseranos, território fechado, eliminação),
           game.ts (novo jogo), actions.ts (redutor de ações + fim de turno).
  render/  Canvas 2D: camera.ts (transformações/zoom) e renderer.ts (arte procedural).
  ui/      DOM/HUD: app.ts (controlador), input.ts (toque/pinça/arrastar/roda),
           menus.ts (novo jogo, salvar/carregar), strings.ts (todos os textos pt-BR), dom.ts.
  ai/      IA de civilizações e cidades-estado: index.ts (`playEndTurn`: cada IA joga e depois
           as regras fecham a rodada; `proposeDeal` para propostas do humano), civAi.ts
           (pesquisa, governo, produção, colonos, construtores, militares), diplomacyAi.ts
           (avaliar acordos, guerra/paz, aproximação, emissários), common.ts (`act`).
  main.ts  Ponto de entrada; registra o service worker em produção.
public/    manifest.webmanifest, sw.js (offline), ícones.
tests/     Vitest para as regras (hex, rng, mapgen, jogo/movimento/névoa, save, cidades,
           construtores, pesquisa/políticas, combate/bárbaros, diplomacia/IA, distritos/maravilhas).
           tests/helpers.ts tem `flatGame()` (mapa de pradaria para testes).
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
- **render/ e ui/ não alteram o estado**: só despacham ações. O fim de turno vai por
  `ai.playEndTurn` (não por `applyAction`) para que as IAs joguem.
- **IA usa as mesmas ações** do humano via `reduceAction` (sem clonar a cada ação).
  `ai/` depende de `rules/`, nunca o contrário.
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
- Estradas: entre dois hexágonos com estrada (centros de cidade contam) o custo é 0,5 e
  ignora terreno e rios.

### Cidades (etapa 2)

- Centro: rendimento do terreno sem característica/melhoria, mínimo 2 comida / 1 produção.
  Capital recebe o Palácio (+2 produção, +3 ouro, +2 ciência, +1 cultura, +1 moradia).
- Cidadãos: 1 por população, trabalham hexágonos do território da cidade até raio 3.
  Distribuição gulosa (`assignCitizens`) pelo foco (Equilibrado/Comida/Produção/Ouro),
  priorizando comida quando o saldo é baixo; hexágonos fixados (`locked`) vêm primeiro.
- Comida: cada cidadão come 2. Crescimento em `15 + 8(n−1) + (n−1)^1,5`. Moradia: base 2,
  +3 rio no centro (ou +1 costa), +edifícios; perto do limite o crescimento cai (50%/25%/0).
  Estoque negativo → perde 1 de população.
- Produção: fila (`queue`), progresso guardado por item (`progress["unit:warrior"]`),
  excedente passa ao próximo item. Colono exige população 2 e consome 1. Compra com ouro
  = 3 × produção restante. Cidade sem produção bloqueia o "Próximo turno" ("Escolher produção").
- Cultura: acumula na cidade; ao atingir `10 + (6·k)^1,3` (k = hexágonos já ganhos) anexa o
  melhor hexágono livre adjacente ao território. Compra de hexágono:
  `15 + 10(d−1) + 2·(hexágonos da cidade) (+10 recurso, +20 maravilha)`.
- Jogador acumula ouro, ciência, cultura e fé (ciência/cultura/fé serão gastos na etapa 3).
- Construtor: 3 cargas. Melhoria ou remoção de característica gasta 1 carga e todo o
  movimento; estrada não gasta carga. Só no próprio território, nunca no centro da cidade.
  Recursos com `improvement` só aceitam aquela melhoria. Derrubar floresta (+20) / selva
  (+15) adiciona produção ao item atual da cidade dona.
- Selva só existe sobre planície (o gerador converte pradaria em planície ao pôr selva).
- Cidadãos geram +1 ciência a cada 2 de população e +1 cultura a cada 3.

### Ciência, cultura e governo (etapa 3)

- Árvores em `data/techs.ts` (18 tecnologias, Antiga→Medieval) e `data/civics.ts` (10 cívicas).
  A ciência/cultura do turno vai para o estoque do jogador (`player.science/culture`) e flui
  inteira para o item atual; o excedente fica no estoque para o próximo. Sem item escolhido,
  o estoque acumula. O botão de turno pede "Escolher pesquisa/cívica" quando há cidade.
- Eureca/inspiração (`data/boosts.ts`): condições declarativas (`cities`, `improvements`,
  `buildings`, `units`, `roads`, `population`, `gold`, `naturalWonderSeen`, `explored`,
  `territory`…) checadas após cada ação e no fim do turno; reduzem o custo em 40%.
- Desbloqueios: `requiresTech` em edifícios e melhorias. Recursos com `revealedBy` ficam
  invisíveis (sem rendimento, sem melhoria, sem ícone) até a tecnologia
  (`visibleResource(t, techs)`; `techs` indefinido = tudo visível, usado em mapgen/testes).
  Carvão, petróleo, alumínio e urânio dependem de tecnologias de eras futuras (ainda ocultos).
- Governo: começa sem governo; Código de Leis adota Chefia automaticamente. Filosofia
  Política libera Autocracia, Oligarquia e República Clássica. Espaços: militar, econômico,
  coringa (aceita qualquer). Governo/políticas só podem mudar no turno em que uma cívica é
  concluída (`policyChangeAvailable`); a UI sugere "Definir políticas" se houver espaço vazio.
- Efeitos genéricos (`Effect` em `data/governments.ts`): `cityYields`, `capitalYields`,
  `yieldPercent`, `productionPercent` (militar/edifício/colono/construtor/todos),
  `tilePurchaseDiscount`, `builderCharges`, `growthPercent`, `extraMoves`. Agregados em
  `rules/effects.ts` e aplicados em `cityYields`, produção, crescimento, compra de hexágonos,
  cargas de construtor e `maxMoves`.

### Combate (etapa 4)

- Vida: unidades 100, cidades 200 (+100 com Muralhas). Dano = `30·e^((A−D)/25)·[0,8–1,2]`
  (máx. 100). Ferimentos: −1 de força a cada 10% de vida perdida. Sorteios usam
  `createRng(seed|combat|rngCounter)` e incrementam `state.rngCounter` (determinístico).
- Defesa: colinas +3, floresta/selva +3, pântano −2, fortificado +6; atacar corpo a corpo
  através de rio −5; `bonusVs` por tipo (lanceiro +10 vs cavalaria, catapulta +15 vs cidade);
  unidades à distância comuns têm −10 contra cidades.
- Corpo a corpo: ambos sofrem dano; se o defensor morre, o atacante avança (captura civis
  restantes). Civis indefesos são capturados sem combate (colono vira construtor; bárbaros
  destroem). À distância: sem retaliação, alcance por `range` (+promoções), alvo visível.
  Atacar encerra o movimento. XP: 5 corpo a corpo, 3 à distância, 3 ao defender.
- Cidade: força `15 + 2·pop + 8 muralhas + 3 capital + 3 colinas + guarnição/4`.
  Com Muralhas ataca à distância (alcance 2) uma vez por turno. Vida 0 + ataque corpo a
  corpo de uma civilização = captura (perde Palácio/Muralhas e 1 pop). Bárbaros não
  capturam. Cidades curam 20/turno.
- ZOC: unidades militares e cidades inimigas controlam os hexágonos adjacentes; mover de
  um hexágono sob ZOC para outro sob ZOC consome todo o movimento.
- Cura (quem não agiu no turno): 10 neutro, 20 próprio território, 25 em cidade, 5 em
  território inimigo, + promoções. Promoção (XP 15/45/90/150/240) cura 50 e encerra o turno.
- Unidades: Fundibulário, Arqueiro (Arquearia), Lanceiro e Espadachim (Bronze; Espadachim
  exige Ferro no território), Cavaleiro (Equitação + Cavalos), Catapulta (Engenharia).
- Guerra: `atWar` — por enquanto só contra bárbaros (diplomacia na etapa 5).
- Bárbaros: jogador especial `isBarbarian` (sem cidades/pesquisa). Acampamentos fora da
  vista e a ≥ 7 de cidades; geram unidade a cada 7–11 turnos (máx. 3 por acampamento),
  tipo conforme o turno; novo acampamento a cada 20 turnos até o limite do mapa. Atacam
  alvos a até 6 hexágonos (preferem civis), senão vagueiam perto do acampamento. Entrar
  num acampamento com unidade militar o destrói: +25 ouro. Agem no fim do turno do jogador.

### Diplomacia e IA (etapa 5)

- Jogadores: 0 = humano, 1 = bárbaros, depois civilizações rivais e cidades-estado
  (padrões por tamanho de mapa, ajustáveis no Novo jogo). Cidades-estado começam com a
  cidade fundada (sem Palácio).
- Relações em `state.diplomacy["a-b"]`: contato (`met`), guerra (`war`, `since`), fronteiras
  abertas/amizade com validade (30 turnos), ressentimentos por quem os guarda (decaem 3%/turno).
- Contato: quando um jogador vê unidade, cidade ou território do outro.
- Guerra: exige contato, sem amizade vigente e ≥ 5 turnos de paz; vítima ganha 40 de
  ressentimento e terceiros que conhecem ambos, 10. Paz só após 10 turnos de guerra; ao
  assinar, unidades são expulsas do território alheio.
- Território: em paz sem fronteiras abertas, unidades não entram em território de outra
  civilização (cidades-estado aceitam visitantes); `canOccupy`/A* respeitam isso.
- Opinião da IA = guerra (−40) + amizade (+25) + fronteiras (+8) − ressentimentos −
  fronteiras próximas (−8) + agenda do líder (Construtora, Erudito, Senhor da Guerra,
  Mercadora, Expansionista). Atitude: ≥20 Amigável, ≤−20 Hostil.
- Acordos (`DealItem`): paz, fronteiras abertas, amizade, ouro. A IA aceita se o valor
  (opinião + interesse + ouro) for positivo; propostas da IA ao humano ficam em
  `state.proposals` (expiram em 3 turnos) e aparecem num modal.
- Emissários: +1 por cívica concluída e +1 a cada 15 turnos. 1/3/6 emissários numa
  cidade-estado: +2/+2 do rendimento do tipo na capital e +1 em todas as cidades;
  suserano (≥3 e mais que todos, sem empate) ganha o bônus da cidade-estado.
- Eliminação: sem cidades depois de ter fundado alguma (ou sem nada). Humano eliminado → derrota.
- IA (heurística, determinística): pesquisa barata/preferida pela agenda, governo pela
  agenda, preenche políticas; produção por prioridades (defesa, colonos até a meta,
  construtores, batedor, edifícios), compra com ouro sobrando; colonos buscam o melhor
  local em raio 8; construtores melhoram hexágonos trabalhados/recursos; militares recuam
  feridos, atacam com previsão favorável, caçam bárbaros perto de casa e inimigos em
  guerra, guarnecem cidades; batedores exploram. Declara guerra só se hostil, vizinha,
  turno ≥ 40 e 1,4× mais forte (chance pela agressividade do líder).

### Distritos, maravilhas e habilidades (etapa 6)

- Itens de produção com hexágono: `{ kind: 'district' | 'wonder', id, tile }`. O hexágono é
  escolhido na UI (modo de posicionamento) e fica reservado enquanto estiver na fila.
- Distritos (`data/districts.ts`): Campus, Lugar Sagrado, Praça Teatral, Centro Comercial,
  Zona Industrial, Acampamento Militar, Porto (na costa). Custo 60. Limite por cidade:
  `1 + ⌊(pop−1)/3⌋`. Hexágono do território (raio 3), não centro, sem maravilha/distrito,
  sem recurso de luxo/estratégico; vira não trabalhável e perde melhoria/característica.
- Adjacência (frações somadas e arredondadas para baixo): montanha, selva, floresta,
  maravilha natural/mundial, distrito/centro de cidade, rio, mina, pedreira, recurso marinho.
- Edifícios com `district` exigem o distrito (Biblioteca/Universidade → Campus, Santuário/
  Templo → Lugar Sagrado, Mercado → Centro Comercial, Oficina → Zona Industrial, Farol →
  Porto, Quartel → Acampamento, Anfiteatro → Praça Teatral); `requiresBuilding` encadeia
  (Universidade exige Biblioteca). Saves antigos mantêm os edifícios já construídos.
- Acampamento Militar: +25% de produção militar e +10 XP; Quartel: +15 XP.
- Maravilhas mundiais (`data/worldWonders.ts`, 11, todas inventadas): posicionamento por
  regra (rio, costa, colinas, deserto, junto a montanha ou a distrito), rendimento na cidade
  e `effects` para o dono (agregados em `modifiersFor`). Só uma no mundo: ao ser concluída,
  sai da fila das outras cidades. Distritos e maravilhas não podem ser comprados.
- Novo efeito `cityDefense` (Muralha Eterna).
- Habilidades únicas: Valdória +2 ouro em cidades ligadas à capital por estrada; Tamaru +1
  ciência em hexágonos com rio; Norvhal +1 produção em tundra/neve; Qasmira +1 ouro e +1 fé
  em deserto; Yrkaan +1 movimento para unidades que estão em planície.

## Plano das 8 etapas

1. **[CONCLUÍDA] Fundação** — mapa hexagonal procedural com semente (pequeno/médio/grande),
   terrenos, colinas, floresta/selva/pântano, rios nas arestas, recursos bônus/luxo/estratégicos,
   maravilhas naturais; névoa de guerra; câmera (arrastar, pinça, +/−); salvar/carregar com
   versionamento e migração; colono e guerreiro; fundar cidade; próximo turno; PWA + deploy.
2. **[CONCLUÍDA] Cidades e território** — crescimento populacional, comida/produção, trabalho de hexágonos,
   fila de produção (unidades e edifícios), expansão cultural de fronteiras, compra de hexágonos,
   construtores e melhorias (fazenda, mina, pastagem…), estradas, painel da cidade.
3. **[CONCLUÍDA] Ciência e cultura** — árvore de tecnologias e de cívicas, revelação de recursos estratégicos
   (`revealedBy`), governos e cartas de política, eurekas/inspirações.
4. **[CONCLUÍDA] Combate** — força, dano, ZOC, bônus de terreno/rio/fortificação, unidades à distância,
   promoções, acampamentos bárbaros, captura de cidades, muralhas.
5. **[CONCLUÍDA] IA e diplomacia** — civilizações rivais (`src/ai`), múltiplos jogadores no turno,
   primeiro contato, guerra/paz, acordos, agendas dos líderes, cidades-estado.
6. **[CONCLUÍDA] Distritos e maravilhas** — distritos especializados com bônus de adjacência, edifícios,
   maravilhas mundiais, habilidades únicas das civilizações (já descritas em `data/civs.ts`).
7. **Economia e sociedade** — ouro/manutenção, amenidades e recursos de luxo, comércio e rotas,
   religião/fé, grandes personagens, unidades navais e exploração marítima.
8. **Vitória e polimento** — condições de vitória (dominação, ciência, cultura, religião,
   pontuação), eras, tutorial, áudio, animações, acessibilidade, balanceamento e desempenho.

## Registro por etapa

### Etapa 6 (concluída)
- Save v6 (migração 5→6: `districts` e `wonders` nas cidades; `district`/`builtWonder` nos
  hexágonos são opcionais).
- Dados: 7 distritos, 4 edifícios novos (Universidade, Templo, Anfiteatro, Quartel), 11
  maravilhas mundiais; edifícios existentes passam a exigir distrito.
- Regras: posicionamento, limite, adjacência, maravilhas exclusivas, habilidades únicas.
- IA escolhe distritos pela maior adjacência (com preferência da agenda) e tenta
  maravilhas em cidades produtivas.
- UI: seções Distritos/Maravilhas na produção; modo de escolha do hexágono com bônus de
  adjacência no mapa (1º toque escolhe, 2º toque ou "Confirmar"); distritos e maravilhas
  desenhados no mapa; aviso global quando alguém conclui uma maravilha.
- Pendências: custo de distrito não escala com a era; sem especialistas nos distritos;
  sem rotas comerciais (etapa 7).

### Etapa 5 (concluída)
- Save v5 (migração 4→5: `diplomacy`, `proposals`, `envoyTokens`).
- Rivais e cidades-estado no novo jogo (contadores no formulário), agendas e agressividade
  dos líderes, 8 cidades-estado inventadas de 6 tipos.
- Regras de diplomacia, território fechado, emissários/suserania, eliminação.
- IA completa para civilizações e cidades-estado; turno da IA antes do fechamento da rodada.
- UI: botão 🤝 Diplomacia (atitude com explicação, acordos, guerra, emissários), modal de
  propostas recebidas, avisos de contato/guerra/paz/suserania, tela de derrota.
- Pendências: comércio de recursos e acordos de pesquisa; IA não usa estradas nem cerco
  coordenado; vitória/pontuação na etapa 8.

### Etapa 4 (concluída)
- Save v4 (migração 3→4: vida/XP/promoções das unidades, vida das cidades, jogador
  bárbaro, `camps`, `rngCounter`).
- Regras de combate, ZOC, cura, promoções, captura de civis e cidades, Muralhas e ataque
  da cidade, bárbaros (acampamentos, geração, comportamento), unidades militares novas com
  requisito de tecnologia e de recurso estratégico.
- UI: alvos em vermelho ao selecionar unidade/cidade; 1º toque mostra a previsão (forças e
  dano), 2º toque ou "Atacar" confirma; barras de vida; ★ quando há promoção; modal de
  promoções; acampamentos no mapa; inspeção de unidades inimigas; avisos de combate.
- Pendências: sem animações de combate; sem flanqueamento/apoio; bárbaros não saqueiam
  melhorias; unidades navais na etapa 7.

### Etapa 3 (concluída)
- Save v3 (migração 2→3: pesquisa, cívicas, eurecas, governo e políticas no jogador).
- Dados: 18 tecnologias, 10 cívicas, 4 governos, 13 políticas, condições de eureca/inspiração.
- Regras: pesquisa com estoque e excedente, eurecas/inspirações, desbloqueio de edifícios e
  melhorias, revelação de recursos estratégicos, governos e espaços, efeitos de políticas.
- UI: modais de Tecnologias e Cívicas por nível (estado, custo, turnos, pré-requisitos,
  eureca), modal de Governo e políticas (seleção por espaço), botões 🔬/🎭 na barra
  superior, avisos de conclusão/eureca, melhorias bloqueadas mostram a tecnologia exigida.
- Pendências: unidades liberadas por tecnologia entram com o combate (etapa 4); eras
  posteriores da árvore (etapa 8); troca de políticas paga em ouro não existe.

### Etapa 2 (concluída)
- Esquema do save v2 (migração 1→2 + `normalizeState` ao carregar).
- Dados: edifícios (Monumento, Celeiro, Moinho d’Água, Oficina, Santuário, Biblioteca,
  Mercado, Farol, Palácio automático), melhorias (Fazenda, Mina, Pedreira, Pastagem,
  Plantação, Acampamento), unidades Construtor e Batedor, custos de produção.
- Regras: rendimentos, cidadãos, crescimento/fome, moradia, fila de produção com excedente,
  compra de itens e hexágonos, expansão cultural de fronteiras, construtores e estradas.
- UI: tocar na cidade abre o painel (estoques, turnos, foco, fila) e a visão da cidade no
  mapa (rendimentos por hexágono, cidadãos ● branco / fixado ● amarelo, preços dos hexágonos
  compráveis); modal de produção com fila e compra; ações do construtor; barra de recursos
  (ouro/ciência/cultura/fé com saldo por turno); estandarte da cidade com produção.
- Pendências: requisitos de tecnologia (`requiresTech`) ainda não são verificados (etapa 3);
  sem manutenção em ouro (etapa 7); sem especialistas; melhorias aquáticas na etapa 7.

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
