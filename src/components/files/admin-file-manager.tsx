'use client';

import * as React from 'react';
import { formatDistance } from 'date-fns';
import { enUS, zhCN } from 'date-fns/locale';
import {
  AlertCircle,
  Download,
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  MoreHorizontal,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiFetch } from '@/lib/shared/auth-client';

interface AdminFileMetadata {
  id: string;
  userId: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedByEmail: string;
  folder?: string | null;
  provider?: string;
  createdAt: string | Date;
}

interface AdminStorageStats {
  totalFiles: number;
  totalSize: number;
  totalSizeMB: number;
  filesByType: Array<{
    mimeType: string;
    count: number;
    size: number;
  }>;
}

interface AdminFilesResponse {
  success?: boolean;
  files?: AdminFileMetadata[];
  pagination?: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
}

interface AdminStatsResponse {
  success?: boolean;
  stats?: AdminStorageStats;
}

const PAGE_SIZE = 25;

export function AdminFileManager() {
  const t = useTranslations('components.files.adminFileManager');
  const locale = useLocale();
  const dateLocale = locale.startsWith('zh') ? zhCN : enUS;
  const [files, setFiles] = React.useState<AdminFileMetadata[]>([]);
  const [stats, setStats] = React.useState<AdminStorageStats | null>(null);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [ownerFilter, setOwnerFilter] = React.useState('');
  const [folderFilter, setFolderFilter] = React.useState('');
  const [providerFilter, setProviderFilter] = React.useState('');
  const [mimeTypeFilter, setMimeTypeFilter] = React.useState('');
  const [minSizeFilter, setMinSizeFilter] = React.useState('');
  const [maxSizeFilter, setMaxSizeFilter] = React.useState('');
  const [startDateFilter, setStartDateFilter] = React.useState('');
  const [endDateFilter, setEndDateFilter] = React.useState('');
  const [offset, setOffset] = React.useState(0);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = React.useState<string[]>([]);
  const [bulkWorking, setBulkWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchFiles = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const trimmedSearch = searchTerm.trim();
      if (trimmedSearch) {
        params.set('search', trimmedSearch);
      }
      const trimmedOwner = ownerFilter.trim();
      if (trimmedOwner) {
        params.set('owner', trimmedOwner);
      }
      const trimmedMimeType = mimeTypeFilter.trim();
      if (trimmedMimeType) {
        params.set('mimeType', trimmedMimeType);
      }
      const trimmedFolder = folderFilter.trim();
      if (trimmedFolder) {
        params.set('folder', trimmedFolder);
      }
      const trimmedProvider = providerFilter.trim();
      if (trimmedProvider) {
        params.set('provider', trimmedProvider);
      }
      const minSizeBytes = sizeMbToBytes(minSizeFilter);
      if (minSizeBytes !== null) {
        params.set('minSize', String(minSizeBytes));
      }
      const maxSizeBytes = sizeMbToBytes(maxSizeFilter);
      if (maxSizeBytes !== null) {
        params.set('maxSize', String(maxSizeBytes));
      }
      if (startDateFilter) {
        params.set('startDate', startDateFilter);
      }
      if (endDateFilter) {
        params.set('endDate', endDateFilter);
      }

      const [filesResponse, statsResponse] = await Promise.all([
        apiFetch(`/api/admin/files?${params.toString()}`),
        apiFetch('/api/admin/files?statsOnly=true'),
      ]);

      if (!filesResponse.ok) {
        throw new Error(t('errors.fetchFiles'));
      }
      if (!statsResponse.ok) {
        throw new Error(t('errors.fetchStats'));
      }

      const filesData = (await filesResponse.json()) as AdminFilesResponse;
      const statsData = (await statsResponse.json()) as AdminStatsResponse;

      setFiles(filesData.files ?? []);
      setTotal(filesData.pagination?.total ?? 0);
      setStats(statsData.stats ?? null);
    } catch (error) {
      setError(error instanceof Error ? error.message : t('errors.fetchFiles'));
    } finally {
      setLoading(false);
    }
  }, [
    offset,
    searchTerm,
    ownerFilter,
    mimeTypeFilter,
    folderFilter,
    providerFilter,
    minSizeFilter,
    maxSizeFilter,
    startDateFilter,
    endDateFilter,
    t,
  ]);

  React.useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  function handleSearchChange(value: string) {
    setSearchTerm(value);
    setOffset(0);
  }

  function handleFilterChange(setter: React.Dispatch<React.SetStateAction<string>>, value: string) {
    setter(value);
    setOffset(0);
  }

  function clearFilters() {
    setSearchTerm('');
    setOwnerFilter('');
    setMimeTypeFilter('');
    setFolderFilter('');
    setProviderFilter('');
    setMinSizeFilter('');
    setMaxSizeFilter('');
    setStartDateFilter('');
    setEndDateFilter('');
    setOffset(0);
  }

  async function handleDownload(file: AdminFileMetadata) {
    const response = await apiFetch(`/api/admin/files/${file.id}?download=true`);
    if (!response.ok) {
      setError(t('errors.download'));
      return;
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.originalName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
  }

  async function handleDelete(file: AdminFileMetadata) {
    if (!window.confirm(t('confirm.deleteFile', { name: file.originalName }))) {
      return;
    }

    setDeletingId(file.id);
    setError(null);

    try {
      const response = await apiFetch(`/api/admin/files/${file.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(t('errors.delete'));
      }

      await fetchFiles();
    } catch (error) {
      setError(error instanceof Error ? error.message : t('errors.delete'));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleBulkDelete() {
    if (
      selectedFileIds.length === 0 ||
      !window.confirm(t('confirm.deleteSelected', { count: selectedFileIds.length }))
    ) {
      return;
    }

    setBulkWorking(true);
    setError(null);
    try {
      const response = await apiFetch('/api/admin/files', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', fileIds: selectedFileIds }),
      });

      if (!response.ok) {
        throw new Error(t('errors.bulkDelete'));
      }

      setSelectedFileIds([]);
      await fetchFiles();
    } catch (error) {
      setError(error instanceof Error ? error.message : t('errors.bulkDelete'));
    } finally {
      setBulkWorking(false);
    }
  }

  async function handleRetention(action: 'archive' | 'delete') {
    const actionLabel = action === 'archive' ? t('retention.archive') : t('retention.delete');
    const rawDays = window.prompt(t('confirm.retention', { action: actionLabel }), '90');
    if (!rawDays) {
      return;
    }

    const retentionDays = Number(rawDays);
    if (!Number.isInteger(retentionDays) || retentionDays < 1) {
      setError(t('errors.retentionDaysPositive'));
      return;
    }

    setBulkWorking(true);
    setError(null);
    try {
      const response = await apiFetch('/api/admin/files', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retention',
          retentionDays,
          retentionAction: action,
          folder: folderFilter.trim() || undefined,
          provider: providerFilter.trim() || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(t('errors.retention'));
      }

      await fetchFiles();
    } catch (error) {
      setError(error instanceof Error ? error.message : t('errors.retention'));
    } finally {
      setBulkWorking(false);
    }
  }

  const currentStart = total === 0 ? 0 : offset + 1;
  const currentEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="min-w-0 space-y-6">
      {stats && (
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label={t('stats.totalFiles')} value={stats.totalFiles.toLocaleString(locale)} />
          <StatCard label={t('stats.storageUsed')} value={formatFileSize(stats.totalSize)} />
          <StatCard
            label={t('stats.fileTypes')}
            value={stats.filesByType.length.toLocaleString(locale)}
          />
        </div>
      )}

      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <CardTitle>{t('title')}</CardTitle>
              <CardDescription>{t('description')}</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t('searchPlaceholder')}
                  value={searchTerm}
                  onChange={(event) => handleSearchChange(event.target.value)}
                  className="w-full pl-8"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label={t('actions.refresh')}
                onClick={fetchFiles}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkDelete}
                disabled={selectedFileIds.length === 0 || bulkWorking}
              >
                {t('actions.deleteSelected')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleRetention('archive')}
                disabled={bulkWorking}
              >
                {t('actions.retainArchive')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleRetention('delete')}
                disabled={bulkWorking}
              >
                {t('actions.retainDelete')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="min-w-0 space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid min-w-0 gap-3 rounded-lg border p-4 md:grid-cols-3">
            <FilterField label={t('filters.owner')}>
              <Input
                aria-label={t('filters.owner')}
                placeholder={t('filters.ownerPlaceholder')}
                value={ownerFilter}
                onChange={(event) => handleFilterChange(setOwnerFilter, event.target.value)}
              />
            </FilterField>
            <FilterField label={t('filters.mimeType')}>
              <Input
                aria-label={t('filters.mimeType')}
                placeholder={t('filters.mimeTypePlaceholder')}
                value={mimeTypeFilter}
                onChange={(event) => handleFilterChange(setMimeTypeFilter, event.target.value)}
              />
            </FilterField>
            <FilterField label={t('filters.folder')}>
              <Input
                aria-label={t('filters.folder')}
                placeholder={t('filters.folderPlaceholder')}
                value={folderFilter}
                onChange={(event) => handleFilterChange(setFolderFilter, event.target.value)}
              />
            </FilterField>
            <FilterField label={t('filters.provider')}>
              <Input
                aria-label={t('filters.provider')}
                placeholder={t('filters.providerPlaceholder')}
                value={providerFilter}
                onChange={(event) => handleFilterChange(setProviderFilter, event.target.value)}
              />
            </FilterField>
            <FilterField label={t('filters.uploadedFrom')}>
              <Input
                aria-label={t('filters.uploadedFrom')}
                type="date"
                value={startDateFilter}
                onChange={(event) => handleFilterChange(setStartDateFilter, event.target.value)}
              />
            </FilterField>
            <FilterField label={t('filters.uploadedTo')}>
              <Input
                aria-label={t('filters.uploadedTo')}
                type="date"
                value={endDateFilter}
                onChange={(event) => handleFilterChange(setEndDateFilter, event.target.value)}
              />
            </FilterField>
            <FilterField label={t('filters.minSizeMb')}>
              <Input
                aria-label={t('filters.minSizeMb')}
                type="number"
                min="0"
                step="0.01"
                value={minSizeFilter}
                onChange={(event) => handleFilterChange(setMinSizeFilter, event.target.value)}
              />
            </FilterField>
            <FilterField label={t('filters.maxSizeMb')}>
              <div className="flex gap-2">
                <Input
                  aria-label={t('filters.maxSizeMb')}
                  type="number"
                  min="0"
                  step="0.01"
                  value={maxSizeFilter}
                  onChange={(event) => handleFilterChange(setMaxSizeFilter, event.target.value)}
                />
                <Button type="button" variant="outline" onClick={clearFilters}>
                  {t('actions.clear')}
                </Button>
              </div>
            </FilterField>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, index) => (
                <div key={index} className="h-14 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : files.length === 0 ? (
            <div className="py-12 text-center">
              <File className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="text-lg font-semibold">{t('empty.title')}</h3>
              <p className="text-sm text-muted-foreground">{t('empty.description')}</p>
            </div>
          ) : (
            <Table className="min-w-[1040px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">
                    <input
                      type="checkbox"
                      aria-label={t('selection.selectAll')}
                      checked={files.length > 0 && selectedFileIds.length === files.length}
                      onChange={(event) =>
                        setSelectedFileIds(event.target.checked ? files.map((file) => file.id) : [])
                      }
                    />
                  </TableHead>
                  <TableHead className="w-[40px]" />
                  <TableHead>{t('table.name')}</TableHead>
                  <TableHead>{t('table.owner')}</TableHead>
                  <TableHead>{t('table.folder')}</TableHead>
                  <TableHead>{t('table.provider')}</TableHead>
                  <TableHead>{t('table.size')}</TableHead>
                  <TableHead>{t('table.uploaded')}</TableHead>
                  <TableHead className="text-right">{t('table.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={t('selection.selectFile', { name: file.originalName })}
                        checked={selectedFileIds.includes(file.id)}
                        onChange={(event) =>
                          setSelectedFileIds((current) =>
                            event.target.checked
                              ? [...new Set([...current, file.id])]
                              : current.filter((id) => id !== file.id)
                          )
                        }
                      />
                    </TableCell>
                    <TableCell>{getFileIcon(file.mimeType)}</TableCell>
                    <TableCell className="max-w-[260px]">
                      <div className="truncate font-medium" title={file.originalName}>
                        {file.originalName}
                      </div>
                      <div className="truncate text-sm text-muted-foreground" title={file.mimeType}>
                        {file.mimeType}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <div
                        className="truncate text-sm"
                        title={file.uploadedByEmail || t('unknown')}
                      >
                        {file.uploadedByEmail || t('unknown')}
                      </div>
                      <div className="max-w-[220px] truncate text-xs text-muted-foreground">
                        {file.userId}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[140px] truncate" title={file.folder || '-'}>
                      {file.folder || '-'}
                    </TableCell>
                    <TableCell>{file.provider || 'local'}</TableCell>
                    <TableCell>{formatFileSize(file.size)}</TableCell>
                    <TableCell>
                      {formatDistance(new Date(file.createdAt), new Date(), {
                        addSuffix: true,
                        locale: dateLocale,
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('actions.fileActions', { name: file.originalName })}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>{t('table.actions')}</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleDownload(file)}>
                            <Download className="mr-2 h-4 w-4" />
                            {t('actions.download')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            disabled={deletingId === file.id}
                            onClick={() => handleDelete(file)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {deletingId === file.id ? t('actions.deleting') : t('actions.delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <div className="flex items-center justify-between border-t pt-4 text-sm text-muted-foreground">
            <span>{t('pagination.showing', { start: currentStart, end: currentEnd, total })}</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                {t('pagination.previous')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= total || loading}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                {t('pagination.next')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {stats && stats.filesByType.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {stats.filesByType.slice(0, 8).map((item) => (
            <Badge key={item.mimeType} variant="secondary">
              {item.mimeType}: {item.count}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  const id = React.useId();

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {React.isValidElement<{ id?: string }>(children)
        ? React.cloneElement(children, { id })
        : children}
    </div>
  );
}

function sizeMbToBytes(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.floor(parsed * 1024 * 1024);
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) {
    return <FileImage className="h-5 w-5 text-primary" />;
  }
  if (mimeType.startsWith('video/')) {
    return <FileVideo className="h-5 w-5 text-purple-500" />;
  }
  if (mimeType.startsWith('audio/')) {
    return <FileAudio className="h-5 w-5 text-success" />;
  }
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('rar')) {
    return <FileArchive className="h-5 w-5 text-warning" />;
  }
  if (mimeType.includes('text')) {
    return <FileText className="h-5 w-5 text-muted-foreground" />;
  }
  return <File className="h-5 w-5 text-muted-foreground" />;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
