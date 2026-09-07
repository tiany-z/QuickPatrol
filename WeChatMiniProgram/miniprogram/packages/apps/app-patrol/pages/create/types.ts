/**
 * M21: 隐患巡查上报提单页强类型契约
 * (Patrol Create Page MiniProgram Types)
 */

export interface IPatrolDraftPayload {
  schoolId: number;
  userId: number;
  updatedTimestamp: number;
  data: {
    campusId: number;
    categoryId: number;
    title: string;
    desc: string;
    images: string[];
    location1: string;
    location2: string;
    latitude: number | null;
    longitude: number | null;
    priorityLevel: 0 | 1 | 2;
    isPublic: 0 | 1;
    pointId?: number;
  };
}

export interface ICreatePageData {
  campusId: number;
  categoryId: number;
  title: string;
  desc: string;
  images: string[];
  location1: string;
  location2: string;
  latitude: number | null;
  longitude: number | null;
  priorityLevel: 0 | 1 | 2;
  isPublic: 0 | 1;
  isFromQrScan: boolean;
  scannedPointId: number;
  isSubmitting: boolean;
  hasDraftPrompted: boolean;
  clientToken: string;
  categoriesList: Array<{ id: number; name: string; icon?: string }>;
  campusesList: Array<{ id: number; name: string }>;
  categoryIndex: number;
  campusIndex: number;
}
