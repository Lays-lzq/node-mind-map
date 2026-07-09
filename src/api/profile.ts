import { request } from './request';
import type { Profile } from '@/types/profile';

export function fetchProfile() {
    return request<Profile>('/profile');
}
