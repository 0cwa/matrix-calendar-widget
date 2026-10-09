const MAX_FRAME_WAIT_MS = 30_000;
const FRAME_POLL_INTERVAL_MS = 50;

export async function hasUniqueWidgetFrameOwnedByElement({
  getFrames,
  parentFrame,
  ownerElement,
  expectedOrigin,
  timeoutMs = MAX_FRAME_WAIT_MS,
}) {
  if (
    typeof getFrames !== 'function' ||
    parentFrame === null ||
    typeof parentFrame !== 'object' ||
    ownerElement === null ||
    typeof ownerElement !== 'object' ||
    typeof ownerElement.evaluate !== 'function' ||
    typeof expectedOrigin !== 'string' ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_FRAME_WAIT_MS
  ) {
    return false;
  }

  try {
    const parsedOrigin = new URL(expectedOrigin);
    if (
      parsedOrigin.origin !== expectedOrigin ||
      !['http:', 'https:'].includes(parsedOrigin.protocol)
    ) {
      return false;
    }
  } catch {
    return false;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let frames;
    try {
      frames = getFrames();
    } catch {
      return false;
    }
    if (!Array.isArray(frames) || frames.length > 1_024) return false;

    const matchingFrames = [];
    for (const frame of frames) {
      if (
        frame === null ||
        typeof frame !== 'object' ||
        typeof frame.parentFrame !== 'function' ||
        typeof frame.frameElement !== 'function' ||
        typeof frame.url !== 'function'
      ) {
        continue;
      }
      try {
        if (frame.parentFrame() !== parentFrame) continue;
        const owner = await frame.frameElement();
        if (!owner) continue;
        const isExpectedOwner = await ownerElement.evaluate(
          (expectedElement, candidateElement) =>
            expectedElement === candidateElement,
          owner,
        );
        if (!isExpectedOwner) continue;
        if (new URL(frame.url()).origin === expectedOrigin) {
          matchingFrames.push(frame);
        }
      } catch {
        // A detached frame or stale owner handle is retried until the deadline.
      }
    }
    if (matchingFrames.length === 1) return true;

    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) {
      await new Promise((resolveWait) =>
        setTimeout(resolveWait, Math.min(FRAME_POLL_INTERVAL_MS, remainingMs)),
      );
    }
  }
  return false;
}
