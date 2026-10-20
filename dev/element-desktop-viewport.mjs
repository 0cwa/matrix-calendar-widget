export function resolveDesktopViewportSize(
  configuredViewport,
  browserViewport,
) {
  const viewport = configuredViewport ?? browserViewport;
  if (
    viewport === null ||
    typeof viewport !== 'object' ||
    !Number.isInteger(viewport.width) ||
    viewport.width < 1 ||
    !Number.isInteger(viewport.height) ||
    viewport.height < 1
  ) {
    return null;
  }
  return { width: viewport.width, height: viewport.height };
}
