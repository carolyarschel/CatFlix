/**
 * Ícones do app — os mesmos traços dos modelos de design (§12): 24×24,
 * `stroke="currentColor"`, sem preenchimento.
 *
 * Inline, e não uma biblioteca: são sete ícones. Uma dependência inteira para
 * isso custaria mais no bundle do que o app todo de pôsteres.
 */

type Props = { tamanho?: number; /** espessura do traço; ícone pequeno pede traço mais grosso */ traco?: number };

function Svg({ tamanho = 22, traco = 1.7, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={traco}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconeBusca = (p: Props) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M16.5 16.5L21 21" />
  </Svg>
);

export const IconeRevisar = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3a9 9 0 1 1-7.4 3.9" />
    <path d="M4 3v4h4" />
  </Svg>
);

export const IconeInicio = (p: Props) => (
  <Svg {...p}>
    <path d="M4 11l8-6.5 8 6.5v8a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" />
  </Svg>
);

export const IconeCalendario = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Svg>
);

/** Calendário com um dia marcado: "escolher a data", diferente do "Em breve". */
export const IconeAgenda = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
    <rect x="13" y="13.5" width="4" height="4" rx="1" />
  </Svg>
);

export const IconeMarcador = (p: Props) => (
  <Svg {...p}>
    <path d="M6 3h12v18l-6-4.5L6 21z" />
  </Svg>
);

export const IconeIngresso = (p: Props) => (
  <Svg {...p}>
    <path d="M3 9.5V7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2.5a2.5 2.5 0 0 0 0 5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2.5a2.5 2.5 0 0 0 0-5z" />
    <path d="M14 6v12" />
  </Svg>
);

export const IconeSeta = (p: Props) => (
  <Svg {...p}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);

/**
 * Os rostos do casal, redesenhados do `Icons.png` da Carol (18/11/2026): o gato
 * é a CatFlix, o urso é o HBUrso. Em traço, como os outros ícones, para pegar
 * a cor do perfil por `currentColor` — o PNG traz o urso em azul, mas o §7 da
 * expansão manda usar só as cores dos perfis, sem inventar uma terceira.
 */
export const IconeGato = (p: Props) => (
  <Svg {...p}>
    <path d="M5.6 9.6C4.9 8 4.7 5.9 5.4 3.9c.2-.5.7-.7 1.2-.5 1.6.5 2.9 1.7 3.8 2.9 1.1-.3 2.3-.3 3.4 0 .9-1.2 2.2-2.4 3.8-2.9.5-.2 1 0 1.2.5.7 2 .5 4.1-.2 5.7.8 1.7 1.1 3.6.7 5.4-.8 3.5-3.7 5.5-7.2 5.5s-6.4-2-7.2-5.5c-.4-1.8-.1-3.7.7-5.4Z" />
    <path d="M1.8 12.9l3 .2M1.9 16.3l2.9-.9M22.2 12.9l-3 .2M22.1 16.3l-2.9-.9" />
  </Svg>
);

export const IconeUrso = (p: Props) => (
  <Svg {...p}>
    <path d="M6.3 10.1C4.5 8.9 4.1 6.4 5.5 4.9c1.4-1.5 3.8-1.4 4.9.4 1.1-.2 2.2-.2 3.2 0 1.1-1.8 3.5-1.9 4.9-.4 1.4 1.5 1 4-.8 5.2 1.1 1.5 1.8 3.2 1.8 4.9-.1 3.5-3.3 5.6-7.5 5.6s-7.4-2.1-7.5-5.6c0-1.7.7-3.4 1.8-4.9Z" />
  </Svg>
);

/** Aba "Assistidos" (cineon-expansao §8). */
export const IconeOlho = (p: Props) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

/** Aba "Mais" (cineon-expansao §8). */
export const IconeMaisOpcoes = (p: Props) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="19" cy="12" r="1.4" />
  </Svg>
);

/** O "+" do cabeçalho: adicionar um filme ao acervo (cineon-expansao §4.1). */
export const IconeMais = (p: Props) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconeVoltar = (p: Props) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);

export const IconeEtiqueta = (p: Props) => (
  <Svg {...p}>
    <path d="M3 12V4h8l9 9-8 8z" />
    <circle cx="7.5" cy="7.5" r="1.4" />
  </Svg>
);
