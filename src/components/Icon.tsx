const PATHS = {
  describe: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="16" cy="9" r="1.8" />
      <path d="M3 17l5-6 4 4.5 2.5-2.5L21 19" />
    </>
  ),
  read: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6M8 13h8M8 17h5" />
    </>
  ),
  identify: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L21 21" />
    </>
  ),
  translate: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
    </>
  ),
  ask: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  live: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2" />
    </>
  ),
  photo: (
    <>
      <rect x="7" y="3" width="14" height="14" rx="2" />
      <path d="M17 21H5a2 2 0 0 1-2-2V7M7 14l4-4 3 3 2-2 5 5" />
    </>
  ),
  sample: <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3" />,
  settings: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  speaker: (
    <>
      <path d="M11 5L6 9H3v6h3l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  cloud: <path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8z" />,
  chip: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  star: <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />,
  back: <path d="M15 5l-7 7 7 7" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alert: (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v4M12 17.5v.5" />
    </>
  ),
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  book: <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M8 7h7" />,
} as const;

export type IconName = keyof typeof PATHS;

/** Simple line icons: large, familiar shapes that stay legible for low-vision users. Decorative; buttons carry text labels. */
export function Icon({ name, size = 24, weight = 2 }: { name: IconName; size?: number; weight?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {PATHS[name]}
    </svg>
  );
}
