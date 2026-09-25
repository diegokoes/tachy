import { z } from "zod";
import {
  REPORT_TYPES,
  REPORT_STATUSES,
  REPORT_DIRECTIONS,
} from "@tachy/contract";

export { REPORT_TYPES, REPORT_STATUSES, REPORT_DIRECTIONS };

export const reportTypeSchema = z.enum(REPORT_TYPES);
export const reportStatusSchema = z.enum(REPORT_STATUSES);
export const reportDirectionSchema = z.enum(REPORT_DIRECTIONS);
