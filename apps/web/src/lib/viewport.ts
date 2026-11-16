export type WorkspaceViewportAction =
  | { mode: 'fixed'; heightPx: number; resetWindowScroll: boolean }
  | { mode: 'clear' };

export function resolveWorkspaceViewportAction({
  isWorkspaceShell,
  innerWidth,
  visualHeight,
  offsetTop,
}: {
  isWorkspaceShell: boolean;
  innerWidth: number;
  visualHeight: number;
  offsetTop: number;
}): WorkspaceViewportAction {
  if (!isWorkspaceShell || innerWidth > 900) {
    return { mode: 'clear' };
  }
  return {
    mode: 'fixed',
    heightPx: Math.round(visualHeight),
    resetWindowScroll: offsetTop > 1,
  };
}
