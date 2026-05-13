'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Upload,
  Download,
  Trash2,
  MoreHorizontal,
  File,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  Search,
  RefreshCw,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { formatDistance } from 'date-fns';
import { apiFetch } from '@/lib/shared/auth-client';

/**
 * File Manager Component
 *
 * Comprehensive file management interface
 * Features:
 * - File upload with drag & drop
 * - File listing with pagination
 * - File search
 * - File download
 * - File deletion
 * - Storage usage display
 * - Entitlement limit integration
 */

export interface FileMetadata {
  id: string;
  userId: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedByEmail: string;
  path: string;
  url: string;
  createdAt: Date;
}

export interface StorageStats {
  totalFiles: number;
  totalSize: number;
  totalSizeMB: number;
  filesByType: Array<{
    mimeType: string;
    count: number;
    size: number;
  }>;
}

interface FileManagerProps {
  userId?: string;
  storageLimit?: number; // in MB
  onUploadComplete?: (file: FileMetadata) => void;
  onDeleteComplete?: (fileId: string) => void;
}

export function FileManager({
  userId: _userId,
  storageLimit,
  onUploadComplete,
  onDeleteComplete,
}: FileManagerProps) {
  const t = useTranslations('components.files.fileManager');

  const [files, setFiles] = React.useState<FileMetadata[]>([]);
  const [stats, setStats] = React.useState<StorageStats | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = React.useState(0);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Fetch files and stats
  const fetchFiles = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch files
      const params = new URLSearchParams();
      const trimmedSearch = searchTerm.trim();
      if (trimmedSearch) {
        params.set('search', trimmedSearch);
      }

      const filesResponse = await apiFetch(`/api/files${params.size ? `?${params}` : ''}`);
      if (!filesResponse.ok) {
        throw new Error('Failed to fetch files');
      }
      const filesData = await filesResponse.json();

      // Fetch stats
      const statsResponse = await apiFetch('/api/files?statsOnly=true');
      if (!statsResponse.ok) {
        throw new Error('Failed to fetch storage stats');
      }
      const statsData = await statsResponse.json();

      setFiles(filesData.files || []);
      setStats(statsData.stats || null);
    } catch (error) {
      console.error('Error fetching files:', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch files');
    } finally {
      setLoading(false);
    }
  }, [searchTerm]);

  React.useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  // Handle file selection
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  // Handle file upload
  const handleUpload = async () => {
    if (!selectedFile) return;

    try {
      setUploading(true);
      setError(null);
      setUploadProgress(0);

      const formData = new FormData();
      formData.append('file', selectedFile);

      // Simulate progress (real progress tracking would need XMLHttpRequest)
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      const response = await apiFetch('/api/files', {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || t('failedToUpload'));
      }

      const data = await response.json();

      // Reset state
      setSelectedFile(null);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // Callback
      if (onUploadComplete) {
        onUploadComplete(data.file);
      }

      // Refresh list
      await fetchFiles();
    } catch (error) {
      console.error('Error uploading file:', error);
      setError(error instanceof Error ? error.message : t('failedToUpload'));
      setUploadProgress(0);
    } finally {
      setUploading(false);
    }
  };

  // Handle file download
  const handleDownload = async (file: FileMetadata) => {
    try {
      const response = await apiFetch(`/api/files/${file.id}?download=true`);

      if (!response.ok) {
        throw new Error(t('failedToDownload'));
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.originalName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading file:', error);
      alert(error instanceof Error ? error.message : t('failedToDownload'));
    }
  };

  // Handle file deletion
  const handleDelete = async (file: FileMetadata) => {
    if (!confirm(t('confirmDelete', { name: file.originalName }))) {
      return;
    }

    try {
      const response = await apiFetch(`/api/files/${file.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(t('failedToDelete'));
      }

      // Callback
      if (onDeleteComplete) {
        onDeleteComplete(file.id);
      }

      // Refresh list
      await fetchFiles();
    } catch (error) {
      console.error('Error deleting file:', error);
      alert(error instanceof Error ? error.message : t('failedToDelete'));
    }
  };

  // Calculate storage usage percentage
  const storagePercentage =
    stats && storageLimit ? Math.min((stats.totalSizeMB / storageLimit) * 100, 100) : 0;

  const storageStatus =
    storagePercentage >= 95 ? 'critical' : storagePercentage >= 80 ? 'warning' : 'ok';

  return (
    <div className="space-y-6">
      {/* Storage Usage Card */}
      {stats && (
        <Card>
          <CardHeader>
            <CardTitle>{t('storageUsage')}</CardTitle>
            <CardDescription>
              {t(stats.totalFiles === 1 ? 'filesCount' : 'filesCountPlural', {
                count: stats.totalFiles,
              })}{' '}
              •{' '}
              {storageLimit
                ? t('mbUsedOf', { used: stats.totalSizeMB.toFixed(2), limit: storageLimit })
                : t('mbUsed', { used: stats.totalSizeMB.toFixed(2) })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {storageLimit ? (
              <>
                <Progress
                  value={storagePercentage}
                  className={`h-3 ${
                    storageStatus === 'critical'
                      ? 'bg-destructive-100'
                      : storageStatus === 'warning'
                        ? 'bg-warning-100'
                        : 'bg-success-100'
                  }`}
                />
                <div className="flex items-center justify-between mt-2 text-sm">
                  <span className="text-muted-foreground">
                    {t('percentUsed', { percent: storagePercentage.toFixed(1) })}
                  </span>
                  {storageStatus === 'critical' && (
                    <Badge variant="destructive">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      {t('storageAlmostFull')}
                    </Badge>
                  )}
                  {storageStatus === 'warning' && (
                    <Badge variant="secondary" className="bg-warning-100 text-warning-foreground">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      {t('approachingLimit')}
                    </Badge>
                  )}
                  {storageStatus === 'ok' && (
                    <Badge variant="default">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      {t('good')}
                    </Badge>
                  )}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">{t('unlimitedStorage')}</div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle>{t('uploadFile')}</CardTitle>
          <CardDescription>{t('selectFile')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-4">
            <Input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              disabled={uploading}
              className="flex-1"
            />
            <Button onClick={handleUpload} disabled={!selectedFile || uploading}>
              <Upload className="h-4 w-4 mr-2" />
              {uploading ? t('uploading') : t('upload')}
            </Button>
          </div>

          {uploading && (
            <div className="space-y-2">
              <Progress value={uploadProgress} />
              <div className="text-sm text-muted-foreground text-center">
                {t('percentUploaded', { percent: uploadProgress })}
              </div>
            </div>
          )}

          {selectedFile && !uploading && (
            <div className="text-sm text-muted-foreground">
              {t('selected', {
                name: selectedFile.name,
                size: (selectedFile.size / 1024 / 1024).toFixed(2),
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Files List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('files')}</CardTitle>
              <CardDescription>{t('manageFiles')}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t('searchFiles')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 w-64"
                />
              </div>
              <Button variant="outline" size="sm" onClick={fetchFiles} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-12">
              <File className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">{t('noFilesYet')}</h3>
              <p className="text-sm text-muted-foreground mb-4">{t('uploadFirstFile')}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead>{t('name')}</TableHead>
                  <TableHead>{t('size')}</TableHead>
                  <TableHead>{t('uploaded')}</TableHead>
                  <TableHead className="text-right">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell>{getFileIcon(file.mimeType)}</TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{file.originalName}</div>
                        <div className="text-sm text-muted-foreground">{file.mimeType}</div>
                      </div>
                    </TableCell>
                    <TableCell>{formatFileSize(file.size)}</TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {formatDistance(new Date(file.createdAt), new Date(), {
                          addSuffix: true,
                        })}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t('by', { email: file.uploadedByEmail })}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>{t('actions')}</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleDownload(file)}>
                            <Download className="h-4 w-4 mr-2" />
                            {t('download')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleDelete(file)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            {t('delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Helper functions
 */
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
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  } else {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}
