self.onmessage = (event) => {
  const input = String(event.data || '');
  self.postMessage({ ok: true, length: input.length });
};
