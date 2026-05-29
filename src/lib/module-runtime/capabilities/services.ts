import type { ModuleServiceInvokeOptions, ModuleServicesApi } from '@ploykit/module-sdk';

export type ModuleServiceHandler<TInput = unknown, TResult = unknown> =
  | ((input: TInput) => TResult | Promise<TResult>)
  | ((operation: string, input: TInput) => TResult | Promise<TResult>);

export function createStaticModuleServicesApi(
  handlers: Record<string, ModuleServiceHandler>
): ModuleServicesApi {
  return {
    async invoke<TInput = unknown, TResult = unknown>(
      name: string,
      operationOrInput: string | TInput,
      inputOrOptions?: TInput | ModuleServiceInvokeOptions
    ): Promise<TResult> {
      const handler = handlers[name];
      if (!handler) {
        throw new Error(`MODULE_SERVICE_MISSING: ${name}`);
      }
      const callable = handler as (...args: unknown[]) => TResult | Promise<TResult>;
      if (typeof operationOrInput === 'string' && arguments.length >= 3) {
        if (callable.length >= 2) {
          return (await callable(operationOrInput, inputOrOptions)) as TResult;
        }
        return (await callable(inputOrOptions)) as TResult;
      }
      return (await callable(operationOrInput)) as TResult;
    },
  };
}
