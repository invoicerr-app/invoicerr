'use client';

import { ChevronRight, FolderOpen, FolderOutput, FolderPlus, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useGet, usePost } from '@/hooks/use-fetch';

interface DirectoryItem {
  name: string;
  path: string;
  isDirectory: boolean;
  readable: boolean;
}

interface DirectoryInfo {
  current: string;
  parent: string | null;
  directories: DirectoryItem[];
}

interface FolderSelectProps {
  value?: string;
  onChange?: (path: string) => void;
  disabled?: boolean;
}

export function FolderSelect({ value, onChange, disabled }: FolderSelectProps) {
  const [open, setOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState(value || '/home');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const { t } = useTranslation();

  const { data, loading, error } = useGet<DirectoryInfo>(
    open ? `/api/directories?path=${encodeURIComponent(currentPath || '/')}` : null,
    { method: 'GET' },
  );

  const { trigger: createFolder } = usePost<DirectoryItem>('/api/directories');

  useEffect(() => {
    if (!open && value) {
      setCurrentPath(value);
    }
  }, [value, open]);

  const handleNavigateIntoDirectory = (path: string) => {
    setCurrentPath(path);
  };

  const handleSelectThisFolder = () => {
    onChange?.(currentPath);
    setOpen(false);
  };

  const handleNavigateUp = () => {
    if (data?.parent) {
      setCurrentPath(data.parent);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;

    try {
      const result = await createFolder({ path: currentPath, name: newFolderName });
      if (result?.path) {
        setNewFolderName('');
        setCreatingFolder(false);
        // Navigate into the newly created folder
        setCurrentPath(result.path);
      }
    } catch (err) {
      console.error('Failed to create folder:', err);
    }
  };

  return (
    <>
      <div
        onClick={() => !disabled && setOpen(true)}
        className="flex items-center gap-2 px-3 py-2 rounded-md border border-input bg-background hover:bg-muted/50 cursor-pointer transition-colors"
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
            setOpen(true);
          }
        }}
      >
        <FolderOpen className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <input
          type="text"
          value={currentPath || ''}
          placeholder={t('folderSelect.placeholder')}
          readOnly
          disabled={disabled}
          className="flex-1 bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground cursor-pointer"
        />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('folderSelect.title')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Current path display */}
            <div className="flex items-center gap-2 p-3 bg-muted rounded-md text-sm border border-input min-w-0">
              <FolderOpen className="w-4 h-4 flex-shrink-0" />
              <span className="font-mono text-xs truncate" title={currentPath}>
                {(() => {
                  const parts = currentPath.split('/').filter(Boolean);
                  if (parts.length <= 4) {
                    return currentPath;
                  }
                  return `/${parts[0]}/.../${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
                })()}
              </span>
            </div>

            {/* Navigation buttons */}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setCreatingFolder(true)}
                disabled={loading}
              >
                <FolderPlus className="w-4 h-4 mr-2" />
                {t('folderSelect.newFolder')}
              </Button>
            </div>

            {/* Error message */}
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md border border-destructive/20">
                {error?.message || 'An error occurred'}
              </div>
            )}

            {/* Create folder dialog */}
            {creatingFolder && (
              <div className="p-3 border rounded-md bg-muted/50 space-y-2">
                <Input
                  type="text"
                  placeholder={t('folderSelect.folderName')}
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCreateFolder();
                    } else if (e.key === 'Escape') {
                      setCreatingFolder(false);
                      setNewFolderName('');
                    }
                  }}
                  autoFocus
                  disabled={loading}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    onClick={handleCreateFolder}
                    disabled={!newFolderName.trim() || loading}
                  >
                    {t('folderSelect.create')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setCreatingFolder(false);
                      setNewFolderName('');
                    }}
                    disabled={loading}
                  >
                    {t('folderSelect.cancel')}
                  </Button>
                </div>
              </div>
            )}

            {/* Loading state */}
            {loading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">
                  {t('folderSelect.loading')}
                </span>
              </div>
            )}

            {/* Directories list */}
            {!loading && data?.directories && (
              <div className="border rounded-md overflow-hidden max-h-72 overflow-y-auto">
                <div className="divide-y">
                  {/* Parent directory button */}
                  {data?.parent && (
                    <button
                      onClick={handleNavigateUp}
                      disabled={loading}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-left text-sm"
                    >
                      <FolderOutput className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate font-medium text-muted-foreground">..</span>
                    </button>
                  )}
                  {/* Subdirectories */}
                  {data.directories.map((dir) => (
                    <button
                      key={dir.path}
                      onClick={() => handleNavigateIntoDirectory(dir.path)}
                      disabled={!dir.readable || loading}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-left text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <FolderOpen className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{dir.name}</span>
                      {dir.readable && (
                        <ChevronRight className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* No directories message */}
            {!loading && data?.directories && data.directories.length === 0 && !data?.parent && (
              <div className="text-sm text-muted-foreground text-center py-8">
                {t('folderSelect.noSubdirectories')}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('folderSelect.cancel')}
            </Button>
            <Button type="button" onClick={handleSelectThisFolder} disabled={loading}>
              {t('folderSelect.selectThisFolder')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
