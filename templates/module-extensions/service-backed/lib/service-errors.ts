export function toServiceErrorEnvelope<TJson = unknown>(error: unknown) {
  const message = error instanceof Error ? error.message : 'Service request failed.';
  return {
    ok: false,
    status: 0,
    statusText: 'SERVICE_UNAVAILABLE',
    json: {
      error: {
        code: message.split(':')[0] || 'SERVICE_UNAVAILABLE',
        message,
      },
    } as TJson,
    body: undefined,
    headers: {},
    attempts: 0,
  };
}
