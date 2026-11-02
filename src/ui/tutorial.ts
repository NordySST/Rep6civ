/** Dicas contextuais para quem está começando (mostradas uma vez cada). */
export interface Tip {
  id: string;
  title: string;
  text: string;
}

export const TIPS: Record<string, Tip> = {
  welcome: {
    id: 'welcome',
    title: 'Bem-vindo!',
    text: 'Arraste o mapa com um dedo e use a pinça (ou +/−) para o zoom. Seu Colono está selecionado: toque em “Fundar cidade” para criar a capital.',
  },
  move: {
    id: 'move',
    title: 'Movimento',
    text: 'Toque num hexágono para ver a rota e os turnos; toque de novo para confirmar. Rotas longas continuam sozinhas nos próximos turnos.',
  },
  production: {
    id: 'production',
    title: 'Produção',
    text: 'Cada cidade precisa de algo para produzir. Comece com um Guerreiro ou um Construtor; o Monumento acelera as fronteiras.',
  },
  research: {
    id: 'research',
    title: 'Pesquisa e cívicas',
    text: 'Escolha uma tecnologia (🔬) e uma cívica (🎭). Cumprir a condição de “Eureca/Inspiração” reduz o custo em 40%.',
  },
  city: {
    id: 'city',
    title: 'Sua cidade',
    text: 'Os números nos hexágonos são os rendimentos. Toque num hexágono para fixar um cidadão nele; os preços dourados indicam hexágonos que podem ser comprados.',
  },
  combat: {
    id: 'combat',
    title: 'Combate',
    text: 'Inimigos ao alcance ficam em vermelho. O primeiro toque mostra a previsão de dano; o segundo ataca. Colinas, florestas e fortificação ajudam na defesa.',
  },
  contact: {
    id: 'contact',
    title: 'Diplomacia',
    text: 'Você encontrou outro povo! Em 🤝 veja a atitude do líder, proponha fronteiras abertas ou amizade e envie emissários a cidades-estado.',
  },
  policies: {
    id: 'policies',
    title: 'Governo',
    text: 'Ao concluir uma cívica você pode trocar o governo e as políticas neste turno. Encaixe cada política num espaço compatível.',
  },
  victory: {
    id: 'victory',
    title: 'Como vencer',
    text: 'Há cinco caminhos: dominação, ciência, cultura, religião ou maior pontuação no último turno. Acompanhe no Placar (toque no turno).',
  },
};
