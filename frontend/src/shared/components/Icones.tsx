/**
 * Ícones do app — os mesmos traços dos modelos de design (§12): 24×24,
 * `stroke="currentColor"`, sem preenchimento.
 *
 * Inline, e não uma biblioteca: são sete ícones. Uma dependência inteira para
 * isso custaria mais no bundle do que o app todo de pôsteres.
 */

type Props = { tamanho?: number };

function Svg({ tamanho = 22, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
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
