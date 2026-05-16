/**
 * Tool Site Seed Data Script
 *
 * Initializes basic data required for the tool site:
 * 1. Create global roles (admin, user)
 * 2. Create sample subscription plans (Free, Pro, Enterprise)
 * 3. Create system administrator account
 * 4. Assign admin role and enterprise entitlements
 *
 * ⚠️ Important Notes:
 * - Subscription plans are example data for testing the payment system
 * - Modify pricing, features, and limits according to your business needs
 * - This script is idempotent and can be safely run multiple times
 *
 * Usage: npm run seed:tool-site
 */

// Load environment variables (must be before importing db)
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env file
const envPath = resolve(__dirname, '../.env');
const result = config({ path: envPath });

if (result.error && !process.env.DATABASE_URL) {
  console.error('❌ Failed to load .env file:', result.error);
  process.exit(1);
}

// Ensure required environment variables exist
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL must be set');
  console.error('Please check .env file');
  process.exit(1);
}

// Set defaults to bypass env.ts validation (if not set)
if (!process.env.DB_PROVIDER) {
  process.env.DB_PROVIDER = 'postgres';
}
if (!process.env.NODE_ENV) {
  // Use type assertion to bypass readonly constraint in scripts
  (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
}

if (result.error) {
  console.warn('⚠️ .env file not found, using environment variables from the current process');
} else {
  console.warn('✅ Environment variables loaded successfully');
}
console.warn(`   DB_PROVIDER: ${process.env.DB_PROVIDER}`);
console.warn(`   NODE_ENV: ${process.env.NODE_ENV}`);
console.warn('');

import { db } from '../src/lib/db/client.server';
import {
  roles,
  entitlementPlans,
  user,
  account,
  userProfiles,
  userroles,
  userEntitlements,
} from '../src/lib/db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import {
  PLATFORM_OUTPUT_QUALITY_CAPABILITY,
  PLATFORM_PRIMARY_CREDIT_METRIC,
} from '../src/lib/billing/billing-metrics';

// ═══════════════════════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  admin: {
    email: 'admin@example.com',
    password: 'Admin@123456',
    name: 'System Administrator',
  },
  roles: [
    {
      name: 'System Administrator',
      slug: 'admin',
      description: 'System administrator responsible for platform management and configuration',
      permissions: [
        'admin:access', // Access admin panel
        'user:manage', // Manage users
        'role:manage', // Manage roles
        'plan:manage', // Manage subscription plans
        'system:config', // System configuration
      ],
      isDefault: false,
    },
    {
      name: 'Regular User',
      slug: 'user',
      description: 'Regular user who can manage their own account and settings',
      permissions: [
        'profile:edit', // Edit profile
        'profile:view', // View profile
        'account:manage', // Manage account settings
      ],
      isDefault: true, // Default role for new users
    },
  ],
  plans: [
    {
      name: 'Free',
      slug: 'free',
      langJsonb: {
        en: {
          name: 'Free',
          description: 'Basic access for trying PloyKit',
          featuresList: ['10 credits/month', 'Basic output quality', 'Community support'],
        },
        zh: {
          name: '免费版',
          description: '适合试用与轻度使用',
          featuresList: ['每月 10 点额度', '基础输出质量', '社区支持'],
        },
      },
      features: {
        [PLATFORM_OUTPUT_QUALITY_CAPABILITY]: '480p' as const,
      },
      limits: {
        monthly: { [PLATFORM_PRIMARY_CREDIT_METRIC]: 10 },
        yearly: { [PLATFORM_PRIMARY_CREDIT_METRIC]: 10 },
      },
      pricing: {
        currency: 'USD',
        monthly: 0,
        yearly: 0,
      },
      sortOrder: 1,
      isDefault: true, // Default plan for new users
      isPopular: false,
      stripe: {
        productId: null,
        priceIdMonthly: null,
        priceIdYearly: null,
      },
    },
    {
      name: 'Pro',
      slug: 'pro',
      langJsonb: {
        en: {
          name: 'Pro',
          description: 'For creators and pros who need more capacity',
          featuresList: ['100 credits/month', 'High output quality', 'Priority support'],
        },
        zh: {
          name: '专业版',
          description: '适合高频使用与更高质量输出',
          featuresList: ['每月 100 点额度', '高质量输出', '优先支持'],
        },
      },
      features: {
        [PLATFORM_OUTPUT_QUALITY_CAPABILITY]: '1080p' as const,
      },
      limits: {
        monthly: { [PLATFORM_PRIMARY_CREDIT_METRIC]: 100 },
        yearly: { [PLATFORM_PRIMARY_CREDIT_METRIC]: 100 },
      },
      pricing: {
        currency: 'USD',
        monthly: 9.99,
        yearly: 99,
      },
      sortOrder: 2,
      isDefault: false,
      isPopular: true,
      stripe: {
        productId: null,
        priceIdMonthly: null,
        priceIdYearly: null,
      },
    },
    {
      name: 'Enterprise',
      slug: 'enterprise',
      langJsonb: {
        en: {
          name: 'Enterprise',
          description: 'Unlimited usage and full-quality output',
          featuresList: ['Unlimited credits', 'Original output quality', 'SLA / dedicated support'],
        },
        zh: {
          name: '企业版',
          description: '不限额度，解锁全部能力',
          featuresList: ['不限额度', '原始输出质量', 'SLA / 专属支持'],
        },
      },
      features: {
        [PLATFORM_OUTPUT_QUALITY_CAPABILITY]: 'original' as const,
      },
      limits: {
        monthly: { [PLATFORM_PRIMARY_CREDIT_METRIC]: -1 },
        yearly: { [PLATFORM_PRIMARY_CREDIT_METRIC]: -1 },
      },
      pricing: {
        currency: 'USD',
        monthly: 99,
        yearly: 999,
      },
      sortOrder: 3,
      isDefault: false,
      isPopular: false,
      stripe: {
        productId: null,
        priceIdMonthly: null,
        priceIdYearly: null,
      },
    },
  ],
};

// ═══════════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════════

function log(message: string, type: 'info' | 'success' | 'error' = 'info') {
  const icons = {
    info: '📝',
    success: '✅',
    error: '❌',
  };
  console.warn(`${icons[type]} ${message}`);
}

function logSection(title: string) {
  console.warn('\n' + '='.repeat(60));
  console.warn(`  ${title}`);
  console.warn('='.repeat(60) + '\n');
}

// ═══════════════════════════════════════════════════════════════
// 种子数据创建函数
// ═══════════════════════════════════════════════════════════════

/**
 * Create global roles
 */
async function seedRoles() {
  logSection('Creating Global Roles');

  for (const roleData of CONFIG.roles) {
    try {
      // Check if role already exists
      const existing = await db.query.roles.findFirst({
        where: eq(roles.slug, roleData.slug),
      });

      if (existing) {
        log(`Role "${roleData.name}" (${roleData.slug}) already exists, skipping`, 'info');
        continue;
      }

      // Create role
      const [_newRole] = await db
        .insert(roles)
        .values({
          name: roleData.name,
          slug: roleData.slug,
          description: roleData.description,
          permissions: roleData.permissions,
          isDefault: roleData.isDefault,
        })
        .returning();

      log(`Role "${roleData.name}" (${roleData.slug}) created successfully`, 'success');
      if (roleData.isDefault) {
        log(`  └─ Set as default role`, 'info');
      }
    } catch (error) {
      log(`Failed to create role "${roleData.name}": ${error}`, 'error');
      throw error;
    }
  }
}

/**
 * Create subscription plans
 */
async function seedPlans() {
  logSection('Creating Subscription Plans (Example Data)');

  log(
    '⚠️  These subscription plans are examples only, for testing the payment subscription system',
    'info'
  );
  log('   Modify pricing and features according to your business needs\n', 'info');

  for (const planData of CONFIG.plans) {
    try {
      // Check if plan already exists
      const existing = await db.query.entitlementPlans.findFirst({
        where: eq(entitlementPlans.slug, planData.slug),
      });

      if (existing) {
        log(`Plan "${planData.name}" (${planData.slug}) already exists, skipping`, 'info');
        continue;
      }

      // Create plan
      const [_newPlan] = await db
        .insert(entitlementPlans)
        .values({
          name: planData.name,
          slug: planData.slug,
          langJsonb: (planData as any).langJsonb,
          features: planData.features,
          limits: planData.limits,
          pricing: (planData as any).pricing,
          sortOrder: planData.sortOrder,
          isActive: true,
          isDefault: planData.isDefault,
          isPopular: (planData as any).isPopular ?? false,
          metadata: {},
          stripe: (planData as any).stripe ?? {},
        })
        .returning();

      const monthlyAmount = (planData as any).pricing?.monthly ?? 0;
      const credits = (planData.limits as any).monthly?.[PLATFORM_PRIMARY_CREDIT_METRIC];
      const creditsLabel = credits === -1 ? 'Unlimited' : `${credits} credits/month`;
      const outputQuality = (planData.features as any)[PLATFORM_OUTPUT_QUALITY_CAPABILITY];

      log(`Plan "${planData.name}" (${planData.slug}) created successfully`, 'success');
      log(`  ├─ Price: $${monthlyAmount}/month`, 'info');
      log(`  ├─ Credits: ${creditsLabel}`, 'info');
      log(`  ├─ Output quality: ${outputQuality}`, 'info');
      if (planData.isDefault) {
        log(`  └─ Default plan`, 'info');
      }
    } catch (error) {
      log(`Failed to create plan "${planData.name}": ${error}`, 'error');
      throw error;
    }
  }
}

/**
 * Create system administrator
 */
async function seedAdminUser() {
  logSection('Creating System Administrator');

  try {
    // Check if admin already exists
    const existingAdmin = await db.query.user.findFirst({
      where: eq(user.email, CONFIG.admin.email),
    });

    if (existingAdmin) {
      log(`Admin account ${CONFIG.admin.email} already exists, skipping creation`, 'info');
      return existingAdmin.id;
    }

    // Generate password hash (using Better-Auth compatible format)
    log('Using Better-Auth password hash function', 'info');
    const passwordHash = await hashPassword(CONFIG.admin.password);
    log(`Password hash format: ${passwordHash.substring(0, 30)}...`, 'info');

    // Create admin user
    const [adminUser] = await db
      .insert(user)
      .values({
        id: `admin_${Date.now()}`,
        email: CONFIG.admin.email,
        emailVerified: true,
        name: CONFIG.admin.name,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    log(`Admin account created successfully`, 'success');
    log(`  ├─ Email: ${CONFIG.admin.email}`, 'info');
    log(`  ├─ Password: ${CONFIG.admin.password}`, 'info');
    log(`  └─ ID: ${adminUser.id}`, 'info');

    // Create account record (store password)
    await db.insert(account).values({
      id: `account_${Date.now()}`,
      providerId: 'credential', // Email password login
      accountId: CONFIG.admin.email, // Use email as accountId
      userId: adminUser.id,
      password: passwordHash, // Store password hash
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    log(`Admin password credentials created successfully (Better-Auth format)`, 'success');

    // Create user profile
    await db.insert(userProfiles).values({
      userId: adminUser.id,
      metadata: {
        role: 'system_admin',
        createdBy: 'seed_script',
        registrationSource: 'seed',
      },
      preferences: {
        theme: 'dark',
        language: 'zh',
      },
    });

    log(`Admin profile created successfully`, 'success');

    return adminUser.id;
  } catch (error) {
    log(`Failed to create admin account: ${error}`, 'error');
    throw error;
  }
}

/**
 * Assign admin role
 */
async function assignAdminRole(adminUserId: string) {
  logSection('Assigning Admin Role');

  try {
    // Find admin role
    const adminRole = await db.query.roles.findFirst({
      where: eq(roles.slug, 'admin'),
    });

    if (!adminRole) {
      throw new Error('Admin role not found');
    }

    // Check if already assigned
    const existing = await db.query.userroles.findFirst({
      where: (userroles, { and, eq }) =>
        and(eq(userroles.userId, adminUserId), eq(userroles.roleId, adminRole.id)),
    });

    if (existing) {
      log('Admin role already assigned, skipping', 'info');
      return;
    }

    // Assign role
    await db.insert(userroles).values({
      userId: adminUserId,
      roleId: adminRole.id,
      grantedBy: adminUserId, // Self-assignment
    });

    log(`Admin role assigned successfully`, 'success');
    log(`  └─ Role: ${adminRole.name} (${adminRole.slug})`, 'info');
  } catch (error) {
    log(`Failed to assign admin role: ${error}`, 'error');
    throw error;
  }
}

/**
 * Assign enterprise entitlements
 */
async function assignEnterprisePlan(adminUserId: string) {
  logSection('Assigning Enterprise Entitlements');

  try {
    // Find Enterprise Plan
    const enterprisePlan = await db.query.entitlementPlans.findFirst({
      where: eq(entitlementPlans.slug, 'enterprise'),
    });

    if (!enterprisePlan) {
      throw new Error('Enterprise Plan not found');
    }

    // Check if already assigned
    const existing = await db.query.userEntitlements.findFirst({
      where: (userEntitlements, { and, eq }) =>
        and(eq(userEntitlements.userId, adminUserId), eq(userEntitlements.status, 'active')),
    });

    if (existing) {
      log('User already has active entitlements, skipping', 'info');
      return;
    }

    // Assign entitlements
    await db.insert(userEntitlements).values({
      userId: adminUserId,
      planId: enterprisePlan.id,
      status: 'active',
      startDate: new Date(),
      endDate: null, // Permanent
      usageMetrics: {},
      metadata: {
        grantedBy: 'seed_script',
        reason: 'system_admin_initial_setup',
      },
    });

    log(`Enterprise entitlements assigned successfully`, 'success');
    log(`  ├─ Plan: ${enterprisePlan.name}`, 'info');
    log(`  └─ Valid period: Permanent`, 'info');
  } catch (error) {
    log(`Failed to assign enterprise entitlements: ${error}`, 'error');
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// 主执行函数
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.warn('\n');
  console.warn('╔══════════════════════════════════════════════════════════╗');
  console.warn('║                                                          ║');
  console.warn('║          🚀 Tool Site Seed Data Initialization           ║');
  console.warn('║                                                          ║');
  console.warn('╚══════════════════════════════════════════════════════════╝');
  console.warn('\n');

  try {
    // 1. Create global roles
    await seedRoles();

    // 2. Create entitlement plans
    await seedPlans();

    // 3. Create system administrator
    const adminUserId = await seedAdminUser();

    // 4. Assign admin role
    await assignAdminRole(adminUserId);

    // 5. Assign enterprise entitlements
    await assignEnterprisePlan(adminUserId);

    // Complete
    logSection('Initialization Complete');
    console.warn('✨ All seed data created successfully!\n');
    console.warn('📋 System Administrator Info:');
    console.warn(`   Email: ${CONFIG.admin.email}`);
    console.warn(`   Password: ${CONFIG.admin.password}`);
    console.warn('\n📊 Subscription Plans Overview (Example Data):');
    console.warn('   Free:       $0/month    - 10 calls/month       - 480p');
    console.warn('   Pro:        $9.99/month - 100 calls/month      - 1080p');
    console.warn('   Enterprise: $99/month   - Unlimited calls      - Original');
    console.warn('\n⚠️  Important Notes:');
    console.warn('   1. Subscription plans are example data for testing the payment system');
    console.warn('   2. Adjust pricing and features according to your business needs');
    console.warn('   3. Login and change the admin password immediately');
    console.warn('   4. Run npm run stripe:setup to configure Stripe products\n');

    console.warn('✅ Seed data initialization complete!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Seed data initialization failed:');
    console.error(error);
    process.exit(1);
  }
}

// Execute
void main();
