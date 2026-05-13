'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { TrendingUp, TrendingDown, Users, Puzzle, Shield, CreditCard } from 'lucide-react';
import type { UsageTrends, GrowthTrends } from '@/hooks/use-analytics';
import { Badge } from '@/components/ui/badge';

/**
 * Usage Charts Component Props
 */
interface UsageChartsProps {
  usageTrends: UsageTrends | null;
  growthTrends: GrowthTrends | null;
  loading: boolean;
}

/**
 * Usage Charts Component
 *
 * Displays trend charts using recharts:
 * - Cumulative usage trends (line chart)
 * - Daily growth trends (bar chart)
 * - Key metrics cards
 */
export function UsageCharts({ usageTrends, growthTrends, loading }: UsageChartsProps) {
  // Transform data for cumulative trends chart
  const cumulativeChartData =
    usageTrends?.dateLabels.map((label, index) => ({
      date: label,
      users: usageTrends.users?.data[index] || 0,
      plugins: usageTrends.plugins?.data[index] || 0,
      roles: usageTrends.roles?.data[index] || 0,
      subscriptions: usageTrends.subscriptions?.data[index] || 0,
    })) || [];

  // Transform data for growth chart
  const growthChartData =
    growthTrends?.dateLabels.map((label, index) => ({
      date: label,
      users: growthTrends.newUsers.data[index] || 0,
      plugins: growthTrends.newPlugins.data[index] || 0,
      roles: growthTrends.newRoles.data[index] || 0,
      subscriptions: growthTrends.newSubscriptions.data[index] || 0,
    })) || [];

  const getGrowthIcon = (growth: number | undefined) => {
    if (!growth) return null;
    return growth >= 0 ? (
      <TrendingUp className="h-4 w-4 text-success" />
    ) : (
      <TrendingDown className="h-4 w-4 text-destructive" />
    );
  };

  const getGrowthColor = (growth: number | undefined) => {
    if (!growth) return 'text-muted-foreground';
    return growth >= 0 ? 'text-success' : 'text-destructive';
  };

  return (
    <div className="space-y-6">
      {/* Key Metrics Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Users Growth */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardDescription>Users Growth</CardDescription>
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <div className="h-8 w-16 bg-muted animate-pulse rounded" />
                <div className="h-4 w-24 bg-muted animate-pulse rounded" />
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  <div className="text-2xl font-bold">{usageTrends?.users?.growth || 0}%</div>
                  {getGrowthIcon(usageTrends?.users?.growth)}
                </div>
                <p className={`text-sm ${getGrowthColor(usageTrends?.users?.growth)}`}>
                  {Math.abs(usageTrends?.users?.growth || 0)}% over period
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Plugins Growth */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardDescription>Plugins Growth</CardDescription>
              <Puzzle className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <div className="h-8 w-16 bg-muted animate-pulse rounded" />
                <div className="h-4 w-24 bg-muted animate-pulse rounded" />
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  <div className="text-2xl font-bold">{usageTrends?.plugins?.growth || 0}%</div>
                  {getGrowthIcon(usageTrends?.plugins?.growth)}
                </div>
                <p className={`text-sm ${getGrowthColor(usageTrends?.plugins?.growth)}`}>
                  {Math.abs(usageTrends?.plugins?.growth || 0)}% over period
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Roles Growth */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardDescription>Roles Growth</CardDescription>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <div className="h-8 w-16 bg-muted animate-pulse rounded" />
                <div className="h-4 w-24 bg-muted animate-pulse rounded" />
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  <div className="text-2xl font-bold">{usageTrends?.roles?.growth || 0}%</div>
                  {getGrowthIcon(usageTrends?.roles?.growth)}
                </div>
                <p className={`text-sm ${getGrowthColor(usageTrends?.roles?.growth)}`}>
                  {Math.abs(usageTrends?.roles?.growth || 0)}% over period
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Subscriptions Growth */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardDescription>Subscriptions Growth</CardDescription>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <div className="h-8 w-16 bg-muted animate-pulse rounded" />
                <div className="h-4 w-24 bg-muted animate-pulse rounded" />
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  <div className="text-2xl font-bold">
                    {usageTrends?.subscriptions?.growth || 0}%
                  </div>
                  {getGrowthIcon(usageTrends?.subscriptions?.growth)}
                </div>
                <p className={`text-sm ${getGrowthColor(usageTrends?.subscriptions?.growth)}`}>
                  {Math.abs(usageTrends?.subscriptions?.growth || 0)}% over period
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cumulative Trends Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Cumulative Trends</CardTitle>
          <CardDescription>
            Total counts over time ({usageTrends?.period || 'Loading...'})
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-[400px] flex items-center justify-center">
              <div className="text-center">
                <div className="h-8 w-32 bg-muted animate-pulse rounded mx-auto mb-2" />
                <div className="h-4 w-48 bg-muted animate-pulse rounded mx-auto" />
              </div>
            </div>
          ) : cumulativeChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={cumulativeChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="users"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  name="Users"
                />
                <Line
                  type="monotone"
                  dataKey="plugins"
                  stroke="#10b981"
                  strokeWidth={2}
                  name="Plugins"
                />
                <Line
                  type="monotone"
                  dataKey="roles"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  name="Roles"
                />
                <Line
                  type="monotone"
                  dataKey="subscriptions"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  name="Subscriptions"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[400px] flex items-center justify-center text-muted-foreground">
              No data available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Daily Growth Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Growth</CardTitle>
          <CardDescription>
            New additions per day ({growthTrends?.period || 'Loading...'})
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-[400px] flex items-center justify-center">
              <div className="text-center">
                <div className="h-8 w-32 bg-muted animate-pulse rounded mx-auto mb-2" />
                <div className="h-4 w-48 bg-muted animate-pulse rounded mx-auto" />
              </div>
            </div>
          ) : growthChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={growthChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="users" fill="#3b82f6" name="Users" />
                <Bar dataKey="plugins" fill="#10b981" name="Plugins" />
                <Bar dataKey="roles" fill="#f59e0b" name="Roles" />
                <Bar dataKey="subscriptions" fill="#8b5cf6" name="Subscriptions" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[400px] flex items-center justify-center text-muted-foreground">
              No data available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary Statistics */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Period Summary</CardTitle>
            <CardDescription>Total new additions during this period</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex justify-between">
                    <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                    <div className="h-4 w-16 bg-muted animate-pulse rounded" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">New Users</span>
                  <Badge variant="outline">{growthTrends?.newUsers.total || 0}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">New Plugins</span>
                  <Badge variant="outline">{growthTrends?.newPlugins.total || 0}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">New Roles</span>
                  <Badge variant="outline">{growthTrends?.newRoles.total || 0}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">New Subscriptions</span>
                  <Badge variant="outline">{growthTrends?.newSubscriptions.total || 0}</Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Daily Averages</CardTitle>
            <CardDescription>Average new additions per day</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex justify-between">
                    <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                    <div className="h-4 w-16 bg-muted animate-pulse rounded" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Avg Users/Day</span>
                  <Badge variant="secondary">{growthTrends?.newUsers.average || 0}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Avg Plugins/Day</span>
                  <Badge variant="secondary">{growthTrends?.newPlugins.average || 0}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Avg Roles/Day</span>
                  <Badge variant="secondary">{growthTrends?.newRoles.average || 0}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Avg Subscriptions/Day</span>
                  <Badge variant="secondary">{growthTrends?.newSubscriptions.average || 0}</Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
