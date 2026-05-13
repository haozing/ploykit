import { NextResponse } from 'next/server';

type ISODateString = string;

export interface MockProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface MockSKU {
  id: string;
  productId: string;
  planId: string;
  name: string;
  slug: string;
  price: string;
  currency: string;
  billingInterval: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface MockOrder {
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
  createdAt: ISODateString;
  paidAt: ISODateString | null;
  completedAt: ISODateString | null;
}

export interface MockSubscription {
  id: string;
  userId: string;
  skuId: string;
  billingInterval: string;
  currentPeriodStart: ISODateString;
  currentPeriodEnd: ISODateString;
  status: string;
  cancelAtPeriodEnd: boolean;
  createdAt: ISODateString;
}

// Simple in-memory store for dev/demo to avoid 404s
export const mockProducts: MockProduct[] = [
  {
    id: 'prod_basic',
    name: 'PloyKit Platform',
    slug: 'ploykit-platform',
    description: 'Demo product',
    category: 'saas',
    isActive: true,
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const mockSKUs: MockSKU[] = [
  {
    id: 'sku_basic_monthly',
    productId: 'prod_basic',
    planId: 'plan_basic',
    name: 'Basic - Monthly',
    slug: 'basic-monthly',
    price: '29.99',
    currency: 'USD',
    billingInterval: 'monthly',
    isActive: true,
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'sku_basic_yearly',
    productId: 'prod_basic',
    planId: 'plan_basic',
    name: 'Basic - Yearly',
    slug: 'basic-yearly',
    price: '299.00',
    currency: 'USD',
    billingInterval: 'yearly',
    isActive: true,
    sortOrder: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const mockOrders: MockOrder[] = [
  {
    id: 'order_001',
    userId: 'user_demo',
    orderNumber: 'ORD-001',
    skuId: 'sku_basic_monthly',
    quantity: 1,
    subtotal: '29.99',
    tax: '0',
    discount: '0',
    total: '29.99',
    currency: 'USD',
    status: 'completed',
    createdAt: new Date().toISOString(),
    paidAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  },
];

export const mockSubscriptions: MockSubscription[] = [
  {
    id: 'sub_001',
    userId: 'user_demo',
    skuId: 'sku_basic_monthly',
    billingInterval: 'monthly',
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
    status: 'active',
    cancelAtPeriodEnd: false,
    createdAt: new Date().toISOString(),
  },
];

export function generateId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}`;
}

export function jsonOk(data: unknown, init?: number | ResponseInit) {
  const responseInit: ResponseInit | undefined = typeof init === 'number' ? { status: init } : init;
  return NextResponse.json(data, responseInit);
}
