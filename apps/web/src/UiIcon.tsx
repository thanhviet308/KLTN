export function UiIcon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    conversations: 'M4 4h16v12H9l-5 4V4Z M8 8h8 M8 12h5',
    friends:
      'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3 M18 8a3 3 0 0 1 0 6 M22 21v-3a4 4 0 0 0-3-4',
    incoming: 'M4 4h16v16H4Z M12 7v10 M8 13l4 4 4-4',
    outgoing: 'M4 4h16v16H4Z M12 17V7 M8 11l4-4 4 4',
    search: 'M21 21l-5-5',
    profile: 'M4 21a8 8 0 0 1 16 0',
    compose: 'M13 5H5v14h14v-8 M10 14l1-4 8-8 3 3-8 8-4 1Z',
    info: 'M12 11v6 M12 7h.01',
    microphone:
      'M9 4a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V4Z M5 10v1a7 7 0 0 0 14 0v-1 M12 18v4 M8 22h8',
    image: 'M3 3h18v18H3Z M3 16l5-5 4 4 3-3 6 6 M8 7h.01',
    location:
      'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
    smile:
      'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M8 14c2 3 6 3 8 0 M8 9h.01 M16 9h.01',
    like: 'M7 10v11H3V10h4Z M7 10l5-8c2 0 3 2 2 5l-1 3h6c2 0 3 1 2 3l-2 6c0 1-1 2-3 2H7',
    stop: 'M6 6h12v12H6Z',
    close: 'M6 6l12 12 M18 6 6 18',
    send: 'm3 3 18 9-18 9 4-9-4-9Z M7 12h14',
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.conversations} />
      {name === 'search' && <circle cx="10" cy="10" r="7" />}
      {(name === 'profile' || name === 'friends') && (
        <circle cx={name === 'friends' ? 9 : 12} cy="6" r="4" />
      )}
      {name === 'info' && <circle cx="12" cy="12" r="9" />}
    </svg>
  );
}
