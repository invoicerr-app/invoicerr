import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { normalize, resolve } from 'path';

import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

export interface IDirectoryItem {
    name: string;
    path: string;
    isDirectory: boolean;
    readable: boolean;
}

@Injectable()
export class DirectoryService {
    private readonly logger = new Logger(DirectoryService.name);
    private readonly allowedRoots = [
        '/var/invoicerr',
        '/home',
        '/tmp',
        process.env.HOME || '/root',
        ...(process.platform === 'win32' ? ['C:\\', 'D:\\'] : []),
    ];

    /**
     * List directories in a given path
     * Only returns directories, filters out files
     * If path is /, shows only allowed root directories
     */
    async listDirectories(basePath: string = '/'): Promise<IDirectoryItem[]> {
        try {
            // Normalize the path
            const normalizedPath = normalize(basePath);

            // Special case: if requesting root, show allowed root directories
            if (normalizedPath === '/') {
                const directories: IDirectoryItem[] = [];

                for (const root of this.allowedRoots) {
                    if (!root.startsWith('/')) continue; // Skip Windows paths

                    try {
                        if (existsSync(root)) {
                            const stats = statSync(root);
                            if (stats.isDirectory()) {
                                let readable = true;
                                try {
                                    readdirSync(root);
                                } catch (error) {
                                    readable = false;
                                }

                                directories.push({
                                    name: root.split('/').filter(Boolean).pop() || root,
                                    path: root,
                                    isDirectory: true,
                                    readable,
                                });
                            }
                        }
                    } catch (error) {
                        this.logger.warn(`Failed to read root directory ${root}: ${error}`);
                    }
                }

                directories.sort((a, b) => a.name.localeCompare(b.name));
                return directories;
            }

            this.validatePath(normalizedPath);

            if (!existsSync(normalizedPath)) {
                logger.error(`Path does not exist: ${normalizedPath}`, { category: 'directory', details: { path: normalizedPath } });
                throw new BadRequestException(`Path does not exist: ${normalizedPath}`);
            }

            const stats = statSync(normalizedPath);
            if (!stats.isDirectory()) {
                logger.error(`Path is not a directory: ${normalizedPath}`, { category: 'directory', details: { path: normalizedPath } });
                throw new BadRequestException(`Path is not a directory: ${normalizedPath}`);
            }

            const files = readdirSync(normalizedPath);
            const directories: IDirectoryItem[] = [];

            for (const file of files) {
                try {
                    // Skip hidden files/folders starting with .
                    if (file.startsWith('.')) {
                        continue;
                    }

                    const filePath = resolve(normalizedPath, file);
                    const fileStats = statSync(filePath);

                    if (fileStats.isDirectory()) {
                        let readable = true;
                        try {
                            readdirSync(filePath);
                        } catch (error) {
                            readable = false;
                        }

                        directories.push({
                            name: file,
                            path: filePath,
                            isDirectory: true,
                            readable,
                        });
                    }
                } catch (error) {
                    this.logger.warn(`Failed to read file stats for ${file}: ${error}`);
                    // Skip files that can't be read
                }
            }

            // Sort by name
            directories.sort((a, b) => a.name.localeCompare(b.name));

            return directories.filter(dir => dir.readable);
        } catch (error) {
            logger.error(`Failed to list directories: ${error instanceof Error ? error.message : String(error)}`, { category: 'directory', details: { error } })
            throw new BadRequestException(
                `Failed to list directories: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Get directory info including parent directory
     */
    async getDirectoryInfo(basePath: string = '/'): Promise<{
        current: string;
        parent: string | null;
        directories: IDirectoryItem[];
    }> {
        const normalizedPath = normalize(basePath);

        // Only validate if not root path
        if (normalizedPath !== '/') {
            this.validatePath(normalizedPath);
        }

        const directories = await this.listDirectories(normalizedPath);

        // Get parent directory
        const parentPath = normalizedPath === '/' ? null : resolve(normalizedPath, '..');

        return {
            current: normalizedPath,
            parent: parentPath && this.isPathAllowed(parentPath) ? parentPath : null,
            directories,
        };
    }

    /**
     * Validate that a path is within allowed roots
     */
    private validatePath(path: string): void {
        const normalizedPath = normalize(path);

        // Check if path is within allowed roots
        const isAllowed = this.allowedRoots.some((root) => {
            const normalizedRoot = normalize(root);
            return normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + '/');
        });

        if (!isAllowed) {
            logger.error(`Access denied. Path is not within allowed directories. Allowed roots: ${this.allowedRoots.join(', ')}`, { category: 'directory', details: { path: normalizedPath, allowedRoots: this.allowedRoots } });
            throw new BadRequestException(
                `Access denied. Path is not within allowed directories. Allowed roots: ${this.allowedRoots.join(', ')}`
            );
        }
    }

    /**
     * Check if a path is allowed
     */
    private isPathAllowed(path: string): boolean {
        const normalizedPath = normalize(path);
        return this.allowedRoots.some((root) => {
            const normalizedRoot = normalize(root);
            return normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + '/');
        });
    }

    /**
     * Create a new directory
     */
    async createDirectory(parentPath: string, folderName: string): Promise<IDirectoryItem> {
        try {
            // Validate parent path
            const normalizedParent = normalize(parentPath);
            if (normalizedParent !== '/') {
                this.validatePath(normalizedParent);
            }

            if (!existsSync(normalizedParent)) {
                logger.error(`Parent path does not exist: ${normalizedParent}`, { category: 'directory', details: { parentPath: normalizedParent } });
                throw new BadRequestException(`Parent path does not exist: ${normalizedParent}`);
            }

            const parentStats = statSync(normalizedParent);
            if (!parentStats.isDirectory()) {
                logger.error(`Parent path is not a directory: ${normalizedParent}`, { category: 'directory', details: { parentPath: normalizedParent } });
                throw new BadRequestException(`Parent path is not a directory: ${normalizedParent}`);
            }

            // Validate folder name
            if (!folderName || folderName.trim() === '') {
                logger.error('Folder name cannot be empty', { category: 'directory' });
                throw new BadRequestException('Folder name cannot be empty');
            }

            if (folderName.includes('/') || folderName.includes('\\')) {
                logger.error('Folder name cannot contain path separators', { category: 'directory' });
                throw new BadRequestException('Folder name cannot contain path separators');
            }

            if (folderName.includes('..')) {
                logger.error('Folder name cannot contain parent directory references', { category: 'directory' });
                throw new BadRequestException('Folder name cannot contain parent directory references');
            }

            const newPath = resolve(normalizedParent, folderName);

            if (existsSync(newPath)) {
                logger.error(`Folder already exists: ${newPath}`, { category: 'directory', details: { path: newPath } });
                throw new BadRequestException(`Folder already exists: ${newPath}`);
            }

            // Create the directory
            mkdirSync(newPath, { recursive: false });

            logger.info('Directory created', { category: 'directory', details: { path: newPath } });

            return {
                name: folderName,
                path: newPath,
                isDirectory: true,
                readable: true,
            };
        } catch (error) {
            logger.error(`Failed to create directory: ${error instanceof Error ? error.message : String(error)}`, { category: 'directory', details: { error } });
            throw new BadRequestException(
                `Failed to create directory: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}
