// Reads fetch-mock arguments without stringifying a Request or non-string body.
export function requestUrl(input: RequestInfo | URL | undefined): string {
  if (input instanceof Request) {
    return input.url;
  }
  if (input === undefined) {
    throw new Error("missing fetch input");
  }
  return input.toString();
}

export function requestJson(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") {
    throw new Error("expected a string fetch body");
  }
  return JSON.parse(init.body);
}
