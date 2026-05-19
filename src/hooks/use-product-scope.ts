'use client';

import useSWR from 'swr';
import type {
  CurrentProductScope,
  ProductScopeListState,
  ProductScopeState,
} from '@/lib/product-scope/product-scope-types';
import { API_KEYS, fetcher, postFetcher } from '@/lib/swr';

interface ProductScopeStateResponse {
  success: true;
  data: ProductScopeState;
}

interface ProductScopeListResponse {
  success: true;
  data: ProductScopeListState;
}

interface ProductScopeCommandResponse {
  success: true;
  data: CurrentProductScope;
}

export function useProductScope() {
  const current = useSWR<ProductScopeStateResponse>(API_KEYS.PRODUCT_SCOPE.CURRENT, fetcher, {
    revalidateOnFocus: false,
  });
  const shouldLoadList =
    current.data?.data.product.profile.mode !== undefined &&
    current.data.data.product.profile.mode !== 'hidden-default';
  const list = useSWR<ProductScopeListResponse>(
    shouldLoadList ? API_KEYS.PRODUCT_SCOPE.LIST() : null,
    fetcher,
    {
      revalidateOnFocus: false,
    }
  );

  async function refresh() {
    await Promise.all([current.mutate(), list.mutate()]);
  }

  async function createScope(input: { name: string }) {
    const response = await postFetcher<ProductScopeCommandResponse, { name: string }>(
      API_KEYS.PRODUCT_SCOPE.LIST(),
      { arg: input }
    );
    await refresh();
    return response.data;
  }

  async function switchScope(workspaceId: string) {
    const response = await postFetcher<ProductScopeCommandResponse, { workspaceId: string }>(
      API_KEYS.PRODUCT_SCOPE.SWITCH,
      { arg: { workspaceId } }
    );
    await refresh();
    return response.data;
  }

  return {
    product: current.data?.data.product ?? list.data?.data.product ?? null,
    current: current.data?.data.current ?? null,
    scopes: list.data?.data.scopes ?? [],
    isLoading: current.isLoading || list.isLoading,
    error: current.error ?? list.error ?? null,
    createScope,
    switchScope,
    refresh,
  };
}
