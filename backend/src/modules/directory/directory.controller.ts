import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DirectoryService } from './directory.service';

@ApiTags('directories')
@Controller('directories')
export class DirectoryController {
    constructor(private readonly directoryService: DirectoryService) { }

    @Get()
    @ApiOperation({ summary: 'List directory contents', description: 'Returns the contents of a directory at the given path.' })
    @ApiQuery({ name: 'path', required: false, type: String, description: 'Filesystem path to list. Defaults to "/".' })
    @ApiResponse({ status: 200, description: 'Directory contents retrieved' })
    async listDirectories(@Query('path') path: string = '/') {
        return this.directoryService.getDirectoryInfo(path);
    }

    @Post()
    @ApiOperation({ summary: 'Create a directory', description: 'Creates a new subdirectory at the specified path.' })
    @ApiBody({ schema: { type: 'object', properties: { path: { type: 'string', description: 'Parent directory path' }, name: { type: 'string', description: 'Name of the subdirectory to create' } }, required: ['path', 'name'] } })
    @ApiResponse({ status: 201, description: 'Directory created' })
    async createDirectory(@Body() body: { path: string; name: string }) {
        return this.directoryService.createDirectory(body.path, body.name);
    }
}
