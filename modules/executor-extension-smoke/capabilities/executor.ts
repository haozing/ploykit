export interface ExecutorExtensionSmokeApi {
  ping(input?: { message?: string }): {
    ok: true;
    message: string;
  };
}

const api: ExecutorExtensionSmokeApi = {
  ping(input = {}) {
    return {
      ok: true,
      message: input.message ?? 'executor-extension-smoke',
    };
  },
};

export default {
  api,
};
