import { MultipartFile } from '@fastify/multipart';
import { GarmentColor } from '../garment-color.enum';

export interface UpdateGarmentDto {
  name?: string;
  category?: string;
  brand?: string;
  color?: GarmentColor;
  size?: string;
  notes?: string;
  washingDetails?: string;
  dateAquired?: string;
  /** Move the garment to this wardrobe. */
  wardrobeId?: number;
  files?: AsyncIterableIterator<MultipartFile>;
}
