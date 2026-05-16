/* eslint-disable no-restricted-syntax -- Proxy security modules run in Edge runtime; env.ts is Node-oriented. */

interface ProxyRuntimeEnv {
  nodeEnv: 'development' | 'test' | 'production';
  appUrl?: string;
  authUrl?: string;
  serviceToken?: string;
  apiRateLimitMultiplier?: string;
}

function readNodeEnv(): ProxyRuntimeEnv['nodeEnv'] {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === 'development' || nodeEnv === 'test' || nodeEnv === 'production') {
    return nodeEnv;
  }
  return 'production';
}

export function readProxyRuntimeEnv(): ProxyRuntimeEnv {
  return {
    nodeEnv: readNodeEnv(),
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    authUrl: process.env.BETTER_AUTH_URL,
    serviceToken: process.env.API_SERVICE_TOKEN,
    apiRateLimitMultiplier: process.env.PLOYKIT_API_RATE_LIMIT_MULTIPLIER,
  };
}
