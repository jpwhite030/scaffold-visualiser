import { BuildingData } from './buildingTypes';

// Client-safe project types + display metadata. The server-side store lives in
// lib/projectStore.ts — keep fs/blob imports OUT of this file so the map page
// can import these types without dragging Node modules into the bundle.

export type ProjectStatus = 'enquiry' | 'order' | 'booked' | 'live' | 'off-hired';

export interface Project {
  id: string;             // "PRJ-1001"
  name: string;           // "Two-storey extension — Prince Edward Dr"
  client: string;         // builder / homeowner
  address: string;        // street address
  suburb: string;
  state: string;          // "NSW"
  postcode: string;
  lat: number;
  lng: number;
  price: number;          // AUD, whole dollars
  status: ProjectStatus;
  createdAt: string;      // ISO date
  building?: BuildingData; // snapshot from the visualiser, if saved from a quote
  shareToken?: string;    // unguessable id for the public read-only 3D link;
                          // minted server-side whenever a building snapshot exists
}

export const STATUS_META: Record<ProjectStatus, { label: string; colour: string }> = {
  enquiry:     { label: 'Enquiry',           colour: '#9aa4b2' },
  order:       { label: 'Order',             colour: '#f0a833' },
  booked:      { label: 'Project Booked In', colour: '#4d8de8' },
  live:        { label: 'Project Live',      colour: '#3fbf6f' },
  'off-hired': { label: 'Project Off-Hired', colour: '#e05252' },
};

export const ALL_STATUSES: ProjectStatus[] = ['enquiry', 'order', 'booked', 'live', 'off-hired'];

export function isProjectStatus(s: unknown): s is ProjectStatus {
  return typeof s === 'string' && (ALL_STATUSES as string[]).includes(s);
}

export function fullAddress(p: Project): string {
  return [p.address, p.suburb, p.state, p.postcode].filter(Boolean).join(', ');
}

export function formatPrice(price: number): string {
  return '$' + price.toLocaleString('en-AU', { maximumFractionDigits: 0 });
}
