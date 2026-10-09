import assert from 'node:assert/strict';
import test from 'node:test';
import { hasUniqueWidgetFrameOwnedByElement } from './element-desktop-frame-origin.mjs';

const WIDGET_ORIGIN = 'http://127.0.0.1:8080';

function makeFrame(parent, owner, url) {
  return {
    parentFrame: () => parent,
    frameElement: async () => owner,
    url: () => url,
  };
}

function makeOwnerElement(element) {
  return {
    evaluate: async (callback, candidate) => callback(element, candidate),
  };
}

test('accepts the expected-origin child only when its owner is the titled iframe', async () => {
  const mainFrame = {};
  const titledIframe = {};
  const siblingIframe = {};
  const ownerElement = makeOwnerElement(titledIframe);
  const siblingWidgetFrame = makeFrame(
    mainFrame,
    siblingIframe,
    `${WIDGET_ORIGIN}/calendar`,
  );

  assert.equal(
    await hasUniqueWidgetFrameOwnedByElement({
      getFrames: () => [siblingWidgetFrame],
      parentFrame: mainFrame,
      ownerElement,
      expectedOrigin: WIDGET_ORIGIN,
      timeoutMs: 20,
    }),
    false,
  );

  const titledWidgetFrame = makeFrame(
    mainFrame,
    titledIframe,
    `${WIDGET_ORIGIN}/calendar`,
  );
  assert.equal(
    await hasUniqueWidgetFrameOwnedByElement({
      getFrames: () => [siblingWidgetFrame, titledWidgetFrame],
      parentFrame: mainFrame,
      ownerElement,
      expectedOrigin: WIDGET_ORIGIN,
      timeoutMs: 100,
    }),
    true,
  );
});
