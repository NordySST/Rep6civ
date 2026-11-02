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
npm run e2e:gestures   # com `npm run preview -- --port 4175` rodando: testa pinça/arrasto com toques reais (CDP)
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
           maravilhas mundiais, cidades-estado, religião (panteões, crenças), grandes
           personalidades, projetos, eras,
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
           economy.ts (manutenção, comodidades/humor), trade.ts (rotas comerciais),
           religion.ts (panteão, fundação, pressão, missionários), greatPeople.ts,
           victory.ts (vitórias, pontuação, eras),
           diplomacy.ts (contato, guerra/paz, acordos, opinião/agendas, emissários,
           suseranos, território fechado, eliminação),
           game.ts (novo jogo), actions.ts (redutor de ações + fim de turno).
  render/  Canvas 2D: camera.ts (transformações/zoom) e renderer.ts (arte procedural).
  ui/      DOM/HUD: app.ts (controlador), input.ts (toque/pinça/arrastar/roda),
           menus.ts (novo jogo, salvar/carregar), strings.ts (todos os textos pt-BR), dom.ts,
           prefs.ts (preferências do aparelho), audio.ts (efeitos WebAudio sintetizados),
           tutorial.ts (dicas contextuais).
  ai/      IA de civilizações e cidades-estado: index.ts (`playEndTurn`: cada IA joga e depois
           as regras fecham a rodada; `proposeDeal` para propostas do humano), civAi.ts
           (pesquisa, governo, produção, colonos, construtores, militares), diplomacyAi.ts
           (avaliar acordos, guerra/paz, aproximação, emissários), common.ts (`act`).
  main.ts  Ponto de entrada; registra o service worker em produção.
public/    manifest.webmanifest, sw.js (offline), ícones.
tests/     Vitest para as regras (hex, rng, mapgen, jogo/movimento/névoa, save, cidades,
           construtores, pesquisa/políticas, combate/bárbaros, diplomacia/IA, distritos/maravilhas,
           economia/religião/naval, vitórias).
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
- **Mapa cilíndrico** (Lote D): novos mapas têm `map.wrap = true` (volta leste-oeste; só os
  polos são borda). Toda geometria passa por `rules/hex.ts` (`neighbor`, `distance`,
  `tilesInRadius`, `hexLine`, `wrapCol`), que respeita `dims.wrap`; nunca compare colunas
  diretamente para adjacência/distância. Saves antigos e `flatGame()` não têm volta. O
  renderizador desenha as cópias vizinhas (`worldPeriod`) e usa `nearCenter` para traçar
  linhas que atravessam a emenda (rotas, estradas, animações).
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

- Árvores em `data/techs.ts` (31 tecnologias, Antiga→Moderna) e `data/civics.ts` (14 cívicas).
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

### Economia e sociedade (etapa 7)

- Manutenção por turno: edifícios (`maintenance`, padrão 1), 1 por distrito, 1 por unidade
  militar além de (cidades + 1). Ouro negativo dispensa a unidade militar mais fraca.
  Cidades-estado não pagam. A barra mostra o saldo líquido.
- Comodidades: exigidas `⌈(pop−2)/2⌉`; fontes: cada tipo de luxo melhorado no território
  (+1 a até 4 cidades), edifícios (`amenities`), efeito `amenities`, crença de seguidor.
  Humor: ≥+3 Eufórica (+10% rendimentos e crescimento), 0..+2 Satisfeita, −1..−2
  Descontente (−10% rendimentos, −25% crescimento), ≤−3 Em revolta (−30%, sem crescimento).
  Comida não é afetada pelo percentual.
- Rotas comerciais: Comerciante (Comércio Exterior) numa cidade sua cria rota permanente até
  outra cidade a ≤15 (sua ou de quem está em paz e conhecido). Capacidade 1 + Centros
  Comerciais/Portos. Interna: +1 comida +1 produção; internacional: +3 ouro +1 por distrito
  do destino (+1 se tiver Centro Comercial), destino +1 ouro; política Caravançarás +2 ouro.
  Constrói estradas no caminho por terra. Guerra ou perda de cidade cancela a rota.
- Religião: panteão por 25 de fé (crenças exclusivas). Grande Profeta numa cidade com Lugar
  Sagrado funda a religião (nome + crença de seguidor exclusivos). Pressão por turno de
  cidades seguidoras a ≤10 hexágonos (+1, cidade sagrada +3); converte com ≥20 e maior que a
  atual. Missionário (80 de fé, 3 usos) +100 de pressão. Fundador: +1 ouro na capital por
  cidade seguidora no mundo.
- Grandes personalidades: +1 ponto por distrito do tipo e +1 por edifício dele; custo 60
  (+40 a cada recrutamento do tipo no mundo). Cientista/Escritor: 50% do item atual;
  Mercador: +200 ouro; Engenheiro: +150 produção na cidade; General: +30 XP num raio 2;
  Profeta: funda religião.
- Naval: Galé (Navegação à Vela) e Quadrirreme (Navegação Celeste), só em cidades costeiras.
  Navios andam na costa (oceano com Navegação Celeste) e nas próprias cidades costeiras.
  Unidades terrestres embarcam com Navegação à Vela (oceano com Navegação Celeste):
  embarcar/desembarcar gasta todo o movimento, defesa embarcada 10, não atacam embarcadas;
  só navios atacam no mar. `canEnterTerrain` centraliza as regras de domínio.

### Vitória e polimento (etapa 8)

- Vitórias (`rules/victory.ts`, checadas no fim do turno; a partida pode continuar depois):
  Dominação (controlar todas as capitais originais — `city.originalCapitalOf` — com ≥ 2
  civilizações), Científica (projeto Expedição Celeste, exige todas as tecnologias), Cultural
  (todas as cívicas e cultura acumulada `lifetimeCulture` ≥ 1000 e ≥ 2× a de cada rival
  ativo), Religiosa (sua religião na maioria das cidades de cada civilização ativa, ≥ 2) e
  Pontuação no turno final (`settings.turnLimit`, padrão 250).
- Pontuação: cidades×5 + população + tecnologias×3 + cívicas×3 + maravilhas×15 +
  distritos×2 + grandes personalidades×5 + religião (10 + 2 por cidade seguidora).
- Projetos (`data/projects.ts`, item `kind: 'project'`): Festival Popular (repetível, +60
  ouro e +30 cultura; também evita cidades ociosas na IA) e Expedição Celeste.
- Eras por custo da tecnologia mais avançada (Antiga, Clássica ≥ 80, Medieval ≥ 160);
  evento `eraChanged`.
- Balanceamento: tecnologias iniciais custam 20.
- Polimento de UI: tela de vitória/derrota (continuar jogando), Placar e vitórias (toque no
  turno), dicas de tutorial uma vez por aparelho, efeitos sonoros sintetizados (sem
  arquivos), animação de movimento e números de dano flutuantes, Configurações (som, dicas,
  animações — respeita `prefers-reduced-motion` —, texto maior), foco automático e Esc nos
  diálogos, limite de turnos no Novo jogo. Avisos de outras civilizações só aparecem para
  quem você conhece (sem vazar informação).

### Pós-etapas — Lote A

- Barcos de Pesca (Navegação à Vela): melhoria aquática sobre Peixes/Caranguejos/Pérolas,
  construída por um construtor em terra adjacente (`waterTargets`); +1 comida.
- Saque: unidade militar em território de quem está em guerra com ela saqueia a melhoria
  (`tile.pillaged`, sem rendimento nem luxo; +15 ouro; encerra o movimento). Bárbaros
  saqueiam quando não têm alvo ao alcance; IA em guerra também. Construtor repara sem
  gastar carga.
- Custo de distrito: `60 + 4 × tecnologias do dono`, fixado no item ao entrar na fila
  (`ProductionItem.cost`).
- Trocar governo/políticas fora do turno de cívica: `unlockPolicies` custa
  `30 + 10 × cívicas` de ouro.
- IA: constrói estradas ligando as cidades à capital, repara saques e faz barcos de pesca.
- Expedição Celeste custa 800 (paliativo até as eras novas do Lote C).
- Animações: ataque corpo a corpo "avança e volta", à distância dispara um projétil; o dano
  aparece no impacto. Evento `combat` traz `from` (hexágono do atacante).
- `window.__rep6civ` (somente leitura: câmera e turno) para testes automatizados.

### Pós-etapas — Lote B

- Especialistas: cada distrito tem `1 + edifícios do distrito` vagas
  (`specialistSlots`); o especialista não trabalha hexágono e rende `DistrictDef.specialist`
  (ex.: Campus +2 ciência) e +1 ponto da grande personalidade do distrito. Controle manual
  (+/− no painel, ação `setSpecialists`); cidadãos sem hexágono livre viram especialistas
  automaticamente.
- Troca de luxos (`DealItem` `luxury`): cede o uso de um luxo por 30 turnos
  (`state.luxuryDeals`); quem cede deixa de contar com ele (`tradeableLuxuries` /
  `effectiveLuxuries`). Guerra cancela.
- Acordos de pesquisa (`researchAgreement`): exigem amizade e 100 de ouro de cada lado;
  após 20 turnos, +150 de ciência para ambos (`state.researchAgreements`).
- Flanqueamento/apoio: +2 de ataque corpo a corpo por unidade militar sua ao lado do alvo;
  +2 de defesa por unidade aliada ao lado do defensor (só em combate real).
- IA: cerco coordenado (`siegePlan`: reúne ≥ 3 unidades a ≤ 4 da cidade inimiga mais
  próxima antes de avançar; a guarnição única fica em casa); propõe trocas de luxo e
  acordos de pesquisa; aceita/recusa pelo valor.
- UI: especialistas no painel da cidade; botão 📜 Negociar na Diplomacia (luxos dos dois
  lados, ouro, acordo de pesquisa).
- Save v9 (migração 8→9: `luxuryDeals`, `researchAgreements`; `specialists` é opcional).

### Pós-etapas — Lote C

- Eras novas: Renascentista (≥ 260), Industrial (≥ 400) e Moderna (≥ 600). Árvore com 31
  tecnologias (13 novas: Finanças, Imprensa, Cartografia, Pólvora, Industrialização,
  Economia Política, Máquina a Vapor, Raiamento, Refino, Eletricidade, Combustão, Rádio,
  Fissão Nuclear) e 14 cívicas (Humanismo, Mercantilismo, Nacionalismo, Ideologia).
  Carvão (Industrialização), Petróleo (Refino), Alumínio (Rádio) e Urânio (Fissão Nuclear)
  agora podem ser revelados.
- Conteúdo: Mosqueteiro e Infantaria de Linha (Salitre), Tanque (Petróleo), Caravela,
  Encouraçado (Carvão); Observatório e Laboratório de Pesquisa (Campus), Banco e Bolsa de
  Valores (Centro Comercial), Fábrica e Usina (Zona Industrial); governos Democracia e
  Tecnocracia; políticas Grande Viagem, Escritórios Coloniais, Conscrição, Plano
  Quinquenal. Bárbaros evoluem para Mosqueteiros/Infantaria nos turnos 110/160.
- 4 civilizações novas (total 9): República de Ilhavar (costa/oceano +1 ouro), Reino de
  Kaluun (planície +1 produção), Império Tzeltani (colinas +1 comida), Liga de Oskari
  (floresta +1 ciência). Mapa grande: 5 rivais por padrão.
- Rebalanceamento das vitórias: Expedição Celeste custa 900 (exige as 31 tecnologias);
  Cultural exige todas as cívicas, ≥ 3000 de cultura acumulada e ≥ 1,5× a de cada rival;
  Religiosa exige maioria em cada civilização e > 50% de todas as cidades do mundo;
  pressão religiosa decai 5%/turno, conversão a partir de 40 e cidades de quem fundou outra
  religião recebem metade da pressão estrangeira. Simulações (mapa pequeno, IA em todas as
  civilizações) terminam com vitórias religiosas, culturais e por pontuação entre os turnos
  ~140 e 250; a IA completa a árvore perto do turno 250.

### Pós-etapas — Lote D

- Disputa religiosa: Apóstolo (140 de fé; difunde com 150 e força religiosa 30) e
  Inquisidor (90 de fé; "Remover heresia" apaga outras religiões de uma cidade sua, 3 usos).
  Combate teológico entre unidades religiosas de religiões diferentes (dano como no combate
  comum, +5 em território da própria religião); o perdedor some e sua religião perde 25% da
  pressão nas cidades a ≤ 6, o vencedor ganha +25. Unidades religiosas atravessam fronteiras
  fechadas. IA compra inquisidor quando há heresia e mantém um apóstolo.
- Mapa com volta leste-oeste (ver Convenções): ruído contínuo na emenda, continentes podem
  atravessá-la, oceano forçado só nos polos.
- Multijogador local: até 4 humanos (formulário "Jogadores neste aparelho"); `passTurn` passa
  a vez ao próximo humano e a tela de passagem esconde o mapa; o último humano fecha a
  rodada (`playEndTurn`, que recomeça pelo primeiro humano ativo). Propostas entre humanos
  ficam pendentes e são respondidas na vez do outro.

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
7. **[CONCLUÍDA] Economia e sociedade** — ouro/manutenção, amenidades e recursos de luxo, comércio e rotas,
   religião/fé, grandes personagens, unidades navais e exploração marítima.
8. **[CONCLUÍDA] Vitória e polimento** — condições de vitória (dominação, ciência, cultura, religião,
   pontuação), eras, tutorial, áudio, animações, acessibilidade, balanceamento e desempenho.

## Registro por etapa

### Etapa 8 (concluída)
- Save v8 (migração 7→8: `turnLimit`, `lifetimeCulture`, `originalCapitalOf`, `winner`).
- Vitórias, pontuação, eras, projetos; IA prioriza a Expedição Celeste e usa o Festival
  quando ociosa (simulações de 250 turnos terminam em vitória científica por volta do turno
  150–175, ~20–85 ms por turno no mapa pequeno).
- UI: vitória/derrota, placar, tutorial, áudio, animações, configurações e acessibilidade.
- Correções: avisos de cidades/crescimento/capturas de outras civilizações não vazam mais;
  mensagens internas da IA não aparecem para o humano.
- Ideias futuras: eras posteriores na árvore (renascença em diante), troca de luxos,
  combate religioso, mapa com wrap horizontal, multijogador local, mais civilizações.

### Etapa 7 (concluída)
- Save v7 (migração 6→7: `tradeRoutes`, `religions`, `gpRecruited`, `gpPoints`, `pressure`).
- Dados: manutenção/comodidades dos edifícios, Comerciante, Missionário, Galé,
  Quadrirreme, 6 grandes personalidades com nomes inventados, 8 panteões, 5 crenças de
  seguidor, 6 religiões inventadas.
- Regras e IA: manutenção e dispensa, comodidades e humor, rotas, religião, grandes
  personalidades, navios e embarque; IA escolhe panteão, funda/difunde religião, cria
  rotas, usa personalidades e explora o mar.
- UI: 🪙 abre Economia (saldo, manutenção, luxos, rotas); ✨ abre Religião (panteão,
  religiões); menu com Grandes personalidades; painel da cidade com comodidades, religião,
  rotas e compra de missionário; ações de Comerciante, Missionário e personalidades.
- Pendências: troca de luxos entre civilizações; combate religioso/teológico; vitória e
  pontuação na etapa 8.

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
