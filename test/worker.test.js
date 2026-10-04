import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";

test("forwards requests to the static asset binding", async () => {
  const request = new Request("https://peikoff.net/");
  const response = new Response("website");
  let forwardedRequest;

  const result = await worker.fetch(request, {
    ASSETS: {
      fetch(assetRequest) {
        forwardedRequest = assetRequest;
        return response;
      },
    },
  });

  assert.equal(forwardedRequest, request);
  assert.equal(result, response);
});
