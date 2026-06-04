import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { GenerationService } from '../generation/generation.service';
import { CreateProjectDto, UpdateProjectDto } from './dto/projects.dto';
import { Project, ProjectSummary } from './projects.types';

/**
 * Projects = per-product/campaign workspaces. Generations are tagged with a
 * projectId, so a project's summary shows its ad count + latest thumbnail.
 *
 * In-memory for now (seeded with a few examples); swap for a DB + per-merchant
 * scoping later.
 */
@Injectable()
export class ProjectsService {
  private readonly store = new Map<string, Project>();

  constructor(private readonly generation: GenerationService) {
    for (const name of ['شاور جل', 'شامبو', 'شنطة سفر']) {
      const now = new Date().toISOString();
      const id = randomUUID();
      this.store.set(id, { id, name, createdAt: now, updatedAt: now });
    }
  }

  create(dto: CreateProjectDto): ProjectSummary {
    const now = new Date().toISOString();
    const project: Project = {
      id: randomUUID(),
      name: dto.name.trim(),
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(project.id, project);
    return this.summarize(project);
  }

  list(): ProjectSummary[] {
    return Array.from(this.store.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => this.summarize(p));
  }

  get(id: string): ProjectSummary {
    return this.summarize(this.require(id));
  }

  update(id: string, dto: UpdateProjectDto): ProjectSummary {
    const project = this.require(id);
    const updated: Project = {
      ...project,
      name: dto.name.trim(),
      updatedAt: new Date().toISOString(),
    };
    this.store.set(id, updated);
    return this.summarize(updated);
  }

  remove(id: string): void {
    if (!this.store.delete(id)) {
      throw new NotFoundException(`Project "${id}" not found.`);
    }
  }

  private require(id: string): Project {
    const project = this.store.get(id);
    if (!project) throw new NotFoundException(`Project "${id}" not found.`);
    return project;
  }

  private summarize(project: Project): ProjectSummary {
    const jobs = this.generation
      .listByProject(project.id)
      .filter((j) => j.status === 'succeeded' && j.outputs.length > 0);
    return {
      ...project,
      generationCount: jobs.length,
      thumbnail: jobs[0]?.outputs[0]?.url, // listByProject is newest-first
    };
  }
}
