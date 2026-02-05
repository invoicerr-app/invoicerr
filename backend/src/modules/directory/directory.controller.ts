import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { DirectoryService } from './directory.service';

@Controller('directories')
export class DirectoryController {
  constructor(private readonly directoryService: DirectoryService) {}

  @Get()
  async listDirectories(@Query('path') path: string = '/') {
    return this.directoryService.getDirectoryInfo(path);
  }

  @Post()
  async createDirectory(@Body() body: { path: string; name: string }) {
    return this.directoryService.createDirectory(body.path, body.name);
  }
}
