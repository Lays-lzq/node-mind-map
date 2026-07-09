import { request } from './request';
import type { Project } from '@/types/projects';

export function fetchProjects() {
    return request<Project[]>('/projects');
}
