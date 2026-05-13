import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Mail, Calendar, Shield, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getUserById } from '@/lib/services/user/user-service';
import { UserRoleManager } from '@/components/dashboard/users/user-role-manager';

/**
 * User Detail Page
 *
 * Shows detailed information about a specific user:
 * - Profile information
 * - Roles and permissions
 * - Activity history
 * - Audit logs
 *
 * Updated for user-level architecture:
 * - User roles and subscription details
 * - User subscriptions are now individual
 */
export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  // Await params in Next.js 15
  const { lang, id } = await params;

  // Fetch real user data from service
  const userData = await getUserById(id);

  if (!userData) {
    notFound();
  }

  // Transform data to match the page structure
  const user = {
    id: userData.id,
    name: userData.name || 'Unknown User',
    email: userData.email,
    avatar: userData.image,
    status: userData.emailVerified ? 'active' : 'pending',
    createdAt: userData.createdAt.toISOString(),
    lastLogin: null as string | null,
    emailVerified: userData.emailVerified,

    // Roles: Using real role data
    roles: userData.role
      ? [
          {
            id: userData.role.id,
            name: userData.role.name,
            slug: userData.role.slug,
            permissions: [],
          },
        ]
      : [],

    // Recent activity: real audit-log activity can be added once this page gets a client data panel.
    recentActivity: [
      {
        action: 'UserRegister',
        timestamp: userData.createdAt.toISOString(),
        ipAddress: 'No data',
      },
    ],
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
  };

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Button variant="ghost" asChild>
        <Link href={`/${lang}/admin/users`}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Users
        </Link>
      </Button>

      {/* User Header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-start">
            {/* Avatar */}
            <Avatar className="h-24 w-24">
              <AvatarImage src={user.avatar || undefined} alt={user.name} />
              <AvatarFallback className="text-2xl">{getInitials(user.name)}</AvatarFallback>
            </Avatar>

            {/* User Info */}
            <div className="flex-1 space-y-4">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-bold">{user.name}</h1>
                  <Badge variant={user.status === 'active' ? 'default' : 'secondary'}>
                    {user.status}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Mail className="h-4 w-4" />
                    {user.email}
                    {user.emailVerified && (
                      <Badge variant="outline" className="ml-1 text-xs">
                        Verified
                      </Badge>
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    Joined {new Date(user.createdAt).toLocaleDateString()}
                  </span>
                  <span className="flex items-center gap-1">
                    <Activity className="h-4 w-4" />
                    Last login{' '}
                    {user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'No data'}
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button asChild>
                  <Link href={`/${lang}/admin/users`}>Edit in Users List</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/${lang}/admin/users?tab=rbac`}>Manage Roles</Link>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="roles">Roles & Permissions</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Roles
                </CardTitle>
                <CardDescription>{user.roles.length} roles assigned</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {user.roles.length > 0 ? (
                    user.roles.map((role) => (
                      <div key={role.id}>
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-medium">{role.name}</p>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {role.permissions.length} permissions
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No roles assigned</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Recent Activity
                </CardTitle>
                <CardDescription>Latest user actions</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {user.recentActivity.slice(0, 3).map((activity, idx) => (
                    <div key={idx} className="text-sm">
                      <p className="font-medium">{activity.action}</p>
                      <p className="text-muted-foreground">
                        {new Date(activity.timestamp).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Roles Tab */}
        <TabsContent value="roles" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Manage Role</CardTitle>
              <CardDescription>Assign or revoke this user&apos;s active role</CardDescription>
            </CardHeader>
            <CardContent>
              <UserRoleManager
                userId={user.id}
                currentRole={
                  user.roles[0]
                    ? {
                        id: user.roles[0].id,
                        name: user.roles[0].name,
                        slug: user.roles[0].slug,
                        permissions: user.roles[0].permissions,
                      }
                    : null
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Assigned Roles</CardTitle>
              <CardDescription>Roles and permissions for this user</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {user.roles.length > 0 ? (
                  user.roles.map((role) => (
                    <div key={role.id}>
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h4 className="font-semibold">{role.name}</h4>
                          <p className="text-sm text-muted-foreground">
                            {role.permissions.length} permissions
                          </p>
                        </div>
                      </div>
                      {role.permissions.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {role.permissions.map((permission, idx) => (
                            <Badge key={idx} variant="outline" className="text-xs">
                              {permission}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <Separator className="mt-4" />
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No roles assigned to this user</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>User actions and events</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {user.recentActivity.map((activity, idx) => (
                  <div key={idx} className="flex items-start gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                      <Activity className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{activity.action}</p>
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-1">
                        <span>{new Date(activity.timestamp).toLocaleString()}</span>
                        <span>IP: {activity.ipAddress}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
