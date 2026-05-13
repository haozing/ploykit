'use client';

/**
 * Billing Data Hook
 *
 * Provides billing-related data and operations for frontend components.
 * Uses SWR for data fetching with automatic 401 handling.
 */

import { useMemo, useCallback } from 'react';
import useSWR from 'swr';
import { API_KEYS, fetcher } from '@/lib/swr';

// ============================================================
// Types
// ============================================================

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SKU {
  id: string;
  productId: string;
  planId: string;
  name: string;
  slug: string;
  description: string | null;
  price: string;
  currency: string;
  billingInterval: string | null;
  stripeProductId: string | null;
  stripePriceId: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SKUWithDetails extends SKU {
  product?: {
    id: string;
    name: string;
    slug: string;
  };
  plan?: {
    id: string;
    name: string;
    slug: string;
  };
}

export interface Order {
  id: string;
  userId: string;
  orderNumber: string;
  skuId: string;
  quantity: number;
  subtotal: string;
  tax: string;
  discount: string;
  total: string;
  currency: string;
  status: string;
  createdAt: Date;
  paidAt: Date | null;
  completedAt: Date | null;
}

export interface OrderWithDetails extends Order {
  sku?: {
    id: string;
    name: string;
    price: string;
  };
}

export interface Subscription {
  id: string;
  userId: string;
  skuId: string;
  billingInterval: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  status: string;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
}

export interface SubscriptionWithDetails extends Subscription {
  sku?: {
    id: string;
    name: string;
    price: string;
  };
}

export interface BillingStats {
  products: {
    total: number;
    active: number;
  };
  skus: {
    total: number;
    active: number;
  };
  orders: {
    total: number;
    pending: number;
    completed: number;
  };
  subscriptions: {
    total: number;
    active: number;
  };
  revenue: {
    total: number;
    formatted: string;
  };
}

// ============================================================
// Response Types
// ============================================================

interface ProductsResponse {
  products: Product[];
}

interface SKUsResponse {
  skus: SKUWithDetails[];
}

interface OrdersResponse {
  orders: OrderWithDetails[];
}

interface SubscriptionsResponse {
  subscriptions: SubscriptionWithDetails[];
}

// ============================================================
// Individual Hooks
// ============================================================

/**
 * Hook for fetching products
 */
export function useProducts(filters?: { category?: string; isActive?: boolean }) {
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters?.category) params.append('category', filters.category);
    if (filters?.isActive !== undefined) params.append('isActive', String(filters.isActive));
    return params.toString();
  }, [filters?.category, filters?.isActive]);

  const { data, error, isLoading, mutate } = useSWR<ProductsResponse>(
    API_KEYS.BILLING.PRODUCTS(queryString || undefined),
    fetcher
  );

  return {
    products: data?.products || [],
    loading: isLoading,
    error,
    refetch: mutate,
  };
}

/**
 * Hook for fetching SKUs
 */
export function useSKUs(filters?: { productId?: string; isActive?: boolean }) {
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters?.productId) params.append('productId', filters.productId);
    if (filters?.isActive !== undefined) params.append('isActive', String(filters.isActive));
    params.append('includeDetails', 'true');
    return params.toString();
  }, [filters?.productId, filters?.isActive]);

  const { data, error, isLoading, mutate } = useSWR<SKUsResponse>(
    API_KEYS.BILLING.SKUS(queryString),
    fetcher
  );

  return {
    skus: data?.skus || [],
    loading: isLoading,
    error,
    refetch: mutate,
  };
}

/**
 * Hook for fetching orders
 */
export function useOrders(filters?: { status?: string; limit?: number }) {
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.limit) params.append('limit', String(filters.limit));
    params.append('includeDetails', 'true');
    return params.toString();
  }, [filters?.status, filters?.limit]);

  const { data, error, isLoading, mutate } = useSWR<OrdersResponse>(
    API_KEYS.BILLING.ORDERS(queryString),
    fetcher
  );

  return {
    orders: data?.orders || [],
    loading: isLoading,
    error,
    refetch: mutate,
  };
}

/**
 * Hook for fetching subscriptions
 */
export function useSubscriptions(filters?: { status?: string; limit?: number }) {
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.limit) params.append('limit', String(filters.limit));
    params.append('includeDetails', 'true');
    return params.toString();
  }, [filters?.status, filters?.limit]);

  const { data, error, isLoading, mutate } = useSWR<SubscriptionsResponse>(
    API_KEYS.BILLING.SUBSCRIPTIONS(queryString),
    fetcher
  );

  return {
    subscriptions: data?.subscriptions || [],
    loading: isLoading,
    error,
    refetch: mutate,
  };
}

// ============================================================
// Combined Hook
// ============================================================

/**
 * Combined billing hook
 *
 * Fetches all billing data: products, SKUs, orders, subscriptions, and calculates stats.
 */
export function useBilling() {
  const { products, loading: productsLoading, refetch: refetchProducts } = useProducts();
  const { skus, loading: skusLoading, refetch: refetchSKUs } = useSKUs();
  const { orders, loading: ordersLoading, refetch: refetchOrders } = useOrders({ limit: 50 });
  const {
    subscriptions,
    loading: subscriptionsLoading,
    refetch: refetchSubscriptions,
  } = useSubscriptions({ limit: 50 });

  // Calculate stats from data
  const stats = useMemo<BillingStats | null>(() => {
    if (productsLoading || skusLoading || ordersLoading || subscriptionsLoading) {
      return null;
    }

    const activeProducts = products.filter((p) => p.isActive).length;
    const activeSKUs = skus.filter((s) => s.isActive).length;
    const completedOrders = orders.filter((o) => o.status === 'completed').length;
    const activeSubscriptions = subscriptions.filter((s) => s.status === 'active').length;

    const totalRevenue = orders
      .filter((o) => o.status === 'completed')
      .reduce((sum, o) => sum + parseFloat(o.total), 0);

    return {
      products: {
        total: products.length,
        active: activeProducts,
      },
      skus: {
        total: skus.length,
        active: activeSKUs,
      },
      orders: {
        total: orders.length,
        pending: orders.filter((o) => o.status === 'pending').length,
        completed: completedOrders,
      },
      subscriptions: {
        total: subscriptions.length,
        active: activeSubscriptions,
      },
      revenue: {
        total: totalRevenue,
        formatted: new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(totalRevenue),
      },
    };
  }, [
    products,
    skus,
    orders,
    subscriptions,
    productsLoading,
    skusLoading,
    ordersLoading,
    subscriptionsLoading,
  ]);

  // Combined refetch
  const refetch = useCallback(() => {
    void refetchProducts();
    void refetchSKUs();
    void refetchOrders();
    void refetchSubscriptions();
  }, [refetchProducts, refetchSKUs, refetchOrders, refetchSubscriptions]);

  return {
    // Data
    products,
    skus,
    orders,
    subscriptions,
    stats,

    // Loading states
    productsLoading,
    skusLoading,
    ordersLoading,
    subscriptionsLoading,
    statsLoading: productsLoading || skusLoading || ordersLoading || subscriptionsLoading,

    // Fetch functions
    fetchProducts: refetchProducts,
    fetchSKUs: refetchSKUs,
    fetchOrders: refetchOrders,
    fetchSubscriptions: refetchSubscriptions,
    fetchStats: refetch, // Stats are calculated, not fetched separately
  };
}
