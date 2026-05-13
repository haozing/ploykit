'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/_core/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { UsageMetric } from '@/hooks/use-usage';

/**
 * Usage Charts Components
 *
 * Time-series visualization components for usage metrics
 * Features:
 * - Line charts showing usage over time
 * - Area charts with limit lines
 * - Bar charts for comparing metrics
 * - Sparklines for compact displays
 */

export interface TimeSeriesDataPoint {
  timestamp: Date;
  value: number;
  label?: string;
}

export interface UsageTimeSeriesData {
  metric: UsageMetric;
  data: TimeSeriesDataPoint[];
  limit?: number;
  isUnlimited?: boolean;
}

/**
 * Line Chart for Usage Trends
 */
export function UsageLineChart({
  data,
  limit,
  isUnlimited = false,
  title,
  description,
  height = 300,
  showGrid = true,
  showLimit = true,
  className,
}: {
  data: TimeSeriesDataPoint[];
  limit?: number;
  isUnlimited?: boolean;
  title?: string;
  description?: string;
  height?: number;
  showGrid?: boolean;
  showLimit?: boolean;
  className?: string;
}) {
  const t = useTranslations('components.usage.usageCharts');
  const chartRef = React.useRef<HTMLDivElement>(null);

  if (data.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center" style={{ height }}>
          <div className="text-center text-muted-foreground">
            <p>{t('noData')}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.value), limit || 0);
  const minValue = Math.min(...data.map((d) => d.value), 0);
  const range = maxValue - minValue || 1;
  const padding = 40;

  // Calculate chart dimensions
  const chartWidth = 800;
  const chartHeight = height - padding * 2;

  // Create path for line
  const points = data.map((point, index) => {
    const x = padding + (index / (data.length - 1)) * (chartWidth - padding * 2);
    const y = padding + chartHeight - ((point.value - minValue) / range) * chartHeight;
    return `${x},${y}`;
  });

  const linePath = points.length > 0 ? `M ${points.join(' L ')}` : '';

  // Create area fill
  const firstPoint = points[0]?.split(',');
  const lastPoint = points[points.length - 1]?.split(',');
  const areaPath = linePath
    ? `${linePath} L ${lastPoint?.[0]},${padding + chartHeight} L ${firstPoint?.[0]},${padding + chartHeight} Z`
    : '';

  // Calculate limit line position
  const limitY = limit ? padding + chartHeight - ((limit - minValue) / range) * chartHeight : null;

  return (
    <Card className={className}>
      {(title || description) && (
        <CardHeader>
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent>
        <div ref={chartRef} className="relative overflow-x-auto">
          <svg
            width={chartWidth}
            height={height}
            viewBox={`0 0 ${chartWidth} ${height}`}
            className="w-full"
            preserveAspectRatio="none"
          >
            {/* Grid lines */}
            {showGrid && (
              <g className="opacity-20">
                {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                  const y = padding + chartHeight * (1 - ratio);
                  return (
                    <line
                      key={ratio}
                      x1={padding}
                      y1={y}
                      x2={chartWidth - padding}
                      y2={y}
                      stroke="currentColor"
                      strokeWidth="1"
                    />
                  );
                })}
              </g>
            )}

            {/* Area fill */}
            <path d={areaPath} fill="currentColor" className="text-primary opacity-10" />

            {/* Line */}
            <path
              d={linePath}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-primary"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Data points */}
            {points.map((point, index) => {
              const [x, y] = point.split(',').map(Number);
              return (
                <circle
                  key={index}
                  cx={x}
                  cy={y}
                  r="4"
                  fill="currentColor"
                  className="text-primary"
                />
              );
            })}

            {/* Limit line */}
            {showLimit && limitY !== null && !isUnlimited && (
              <>
                <line
                  x1={padding}
                  y1={limitY}
                  x2={chartWidth - padding}
                  y2={limitY}
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray="5,5"
                  className="text-red-500"
                />
                <text
                  x={chartWidth - padding - 5}
                  y={limitY - 5}
                  textAnchor="end"
                  className="text-xs fill-red-500"
                >
                  {t('limit', { limit: limit ?? 0 })}
                </text>
              </>
            )}

            {/* Y-axis labels */}
            {[maxValue, maxValue * 0.75, maxValue * 0.5, maxValue * 0.25, 0].map((value, index) => {
              const y = padding + chartHeight * (index / 4);
              return (
                <text
                  key={index}
                  x={padding - 10}
                  y={y + 4}
                  textAnchor="end"
                  className="text-xs fill-muted-foreground"
                >
                  {Math.round(value).toLocaleString()}
                </text>
              );
            })}
          </svg>

          {/* X-axis labels */}
          <div className="flex justify-between mt-2 px-10 text-xs text-muted-foreground">
            <span>{data[0]?.timestamp.toLocaleDateString()}</span>
            <span>{data[Math.floor(data.length / 2)]?.timestamp.toLocaleDateString()}</span>
            <span>{data[data.length - 1]?.timestamp.toLocaleDateString()}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Sparkline Chart (Compact)
 */
export function UsageSparkline({
  data,
  width = 100,
  height = 30,
  color = 'currentColor',
  showTrend = true,
  className,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showTrend?: boolean;
  className?: string;
}) {
  if (data.length === 0) return null;

  const maxValue = Math.max(...data);
  const minValue = Math.min(...data);
  const range = maxValue - minValue || 1;

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((value - minValue) / range) * height;
    return `${x},${y}`;
  });

  const path = points.length > 0 ? `M ${points.join(' L ')}` : '';

  // Calculate trend
  const firstValue = data[0];
  const lastValue = data[data.length - 1];
  const trend = lastValue - firstValue;
  const trendPercent = firstValue !== 0 ? (trend / firstValue) * 100 : 0;

  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {showTrend && (
        <div
          className={cn(
            'flex items-center text-xs',
            trend > 0 ? 'text-orange-600' : trend < 0 ? 'text-green-600' : 'text-gray-600'
          )}
        >
          {Math.abs(trend) < 0.01 ? (
            <Minus className="h-3 w-3" />
          ) : trend > 0 ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          <span className="ml-1">{trendPercent.toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
}

/**
 * Bar Chart for Metric Comparison
 */
export function UsageBarChart({
  metrics,
  title,
  description,
  height = 300,
  className,
}: {
  metrics: Array<{
    label: string;
    value: number;
    limit?: number;
    status?: 'ok' | 'warning' | 'critical' | 'exceeded';
  }>;
  title?: string;
  description?: string;
  height?: number;
  className?: string;
}) {
  if (metrics.length === 0) return null;

  const maxValue = Math.max(...metrics.map((m) => Math.max(m.value, m.limit || 0)));
  const barWidth = 60;
  const gap = 40;
  const chartWidth = metrics.length * (barWidth + gap);
  const chartHeight = height - 80;
  const padding = 40;

  const getBarColor = (status?: string) => {
    switch (status) {
      case 'exceeded':
        return 'fill-red-500';
      case 'critical':
        return 'fill-orange-500';
      case 'warning':
        return 'fill-amber-500';
      case 'ok':
      default:
        return 'fill-green-500';
    }
  };

  return (
    <Card className={className}>
      {(title || description) && (
        <CardHeader>
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent>
        <div className="overflow-x-auto">
          <svg
            width={Math.max(chartWidth, 600)}
            height={height}
            viewBox={`0 0 ${Math.max(chartWidth, 600)} ${height}`}
            className="w-full min-w-[600px]"
          >
            {metrics.map((metric, index) => {
              const x = padding + index * (barWidth + gap);
              const barHeight = (metric.value / maxValue) * chartHeight;
              const y = padding + chartHeight - barHeight;

              // Limit line
              const limitHeight = metric.limit ? (metric.limit / maxValue) * chartHeight : null;
              const limitY = limitHeight ? padding + chartHeight - limitHeight : null;

              return (
                <g key={index}>
                  {/* Bar */}
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    className={getBarColor(metric.status)}
                    rx="4"
                  />

                  {/* Value label */}
                  <text
                    x={x + barWidth / 2}
                    y={y - 5}
                    textAnchor="middle"
                    className="text-xs fill-foreground font-medium"
                  >
                    {metric.value.toLocaleString()}
                  </text>

                  {/* Limit line */}
                  {limitY !== null && (
                    <>
                      <line
                        x1={x}
                        y1={limitY}
                        x2={x + barWidth}
                        y2={limitY}
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeDasharray="3,3"
                        className="text-red-500"
                      />
                      <text
                        x={x + barWidth / 2}
                        y={limitY - 2}
                        textAnchor="middle"
                        className="text-[10px] fill-red-500"
                      >
                        {metric.limit}
                      </text>
                    </>
                  )}

                  {/* X-axis label */}
                  <text
                    x={x + barWidth / 2}
                    y={padding + chartHeight + 20}
                    textAnchor="middle"
                    className="text-xs fill-muted-foreground"
                  >
                    {metric.label}
                  </text>
                </g>
              );
            })}

            {/* X-axis line */}
            <line
              x1={padding}
              y1={padding + chartHeight}
              x2={padding + chartWidth - gap}
              y2={padding + chartHeight}
              stroke="currentColor"
              strokeWidth="1"
              className="text-border"
            />
          </svg>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Donut Chart for Usage Percentage
 */
export function UsageDonutChart({
  percentage,
  label,
  status,
  size = 120,
  strokeWidth = 12,
  className,
}: {
  percentage: number;
  label: string;
  status?: 'ok' | 'warning' | 'critical' | 'exceeded';
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(percentage, 100) / 100) * circumference;

  const getStrokeColor = () => {
    switch (status) {
      case 'exceeded':
        return 'stroke-red-500';
      case 'critical':
        return 'stroke-orange-500';
      case 'warning':
        return 'stroke-amber-500';
      case 'ok':
      default:
        return 'stroke-green-500';
    }
  };

  return (
    <div className={cn('inline-flex flex-col items-center gap-2', className)}>
      <div className="relative">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-muted opacity-20"
          />

          {/* Progress circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className={getStrokeColor()}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>

        {/* Center text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="text-2xl font-bold">{Math.round(percentage)}%</div>
          </div>
        </div>
      </div>

      <div className="text-sm font-medium text-center">{label}</div>
    </div>
  );
}

/**
 * Multi-Metric Comparison Chart
 */
export function MultiMetricChart({
  data,
  title,
  description,
  className,
}: {
  data: UsageTimeSeriesData[];
  title?: string;
  description?: string;
  className?: string;
}) {
  const [selectedMetric, setSelectedMetric] = React.useState<UsageMetric | null>(
    data[0]?.metric || null
  );

  const selectedData = data.find((d) => d.metric === selectedMetric);

  return (
    <Card className={className}>
      {(title || description) && (
        <CardHeader>
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent>
        <div className="flex flex-wrap gap-2 mb-4">
          {data.map((metric) => (
            <Badge
              key={metric.metric}
              variant={selectedMetric === metric.metric ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setSelectedMetric(metric.metric)}
            >
              {getMetricLabel(metric.metric)}
            </Badge>
          ))}
        </div>

        {selectedData && (
          <UsageLineChart
            data={selectedData.data}
            limit={selectedData.limit}
            isUnlimited={selectedData.isUnlimited}
            showLimit={true}
            showGrid={true}
          />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Helper function to get metric label
 */
function getMetricLabel(metric: UsageMetric): string {
  const labels: Record<UsageMetric, string> = {
    users: 'Users',
    plugins: 'Plugins',
    storage: 'Storage',
    apiCalls: 'API Calls',
  };
  return labels[metric] || metric;
}
