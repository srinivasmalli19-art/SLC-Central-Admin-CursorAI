import { z } from 'zod';

/**
 * Strict schemas for the source-confirmed Stock Management (FieldOps) read
 * endpoints. Upstream JSON is validated against these before anything is
 * returned into Central Admin — arbitrary upstream JSON is never passed through.
 * A parse failure maps to MALFORMED_RESPONSE.
 */

// GET /health (unauthenticated, raw object — not enveloped)
export const healthSchema = z.object({
  status: z.string(),
  timestamp: z.string().optional(),
  env: z.string().optional(),
});

// Stock Management wraps API payloads: { success, data, message?, pagination? }
const paginationSchema = z.object({
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
});

function envelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    success: z.boolean(),
    data,
    message: z.string().optional(),
    pagination: paginationSchema.optional(),
  });
}

// GET /api/monitoring (Super_Admin) — global stats
export const monitoringDataSchema = z.object({
  overview: z.object({
    totalOrgs: z.number(),
    activeOrgs: z.number(),
    totalUsers: z.number(),
    activeUsers30d: z.number(),
    auditEvents24h: z.number(),
  }),
  operations: z.record(z.string(), z.number()).optional(),
});
export const monitoringEnvelopeSchema = envelope(monitoringDataSchema);

// GET /api/users — org-scoped list (Super_Admin = all orgs). `safeUser` shape.
export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  isActive: z.boolean(),
  orgId: z.string().nullable(),
  createdAt: z.union([z.string(), z.date()]).optional(),
});
export const usersEnvelopeSchema = envelope(z.array(userSchema));

// GET /api/organisations (Super_Admin) — tenants
export const organisationSchema = z.object({
  id: z.string(),
  name: z.string(),
  siteCode: z.string().optional(),
  isActive: z.boolean(),
});
export const organisationsEnvelopeSchema = envelope(z.array(organisationSchema));

export type HealthPayload = z.infer<typeof healthSchema>;
export type MonitoringData = z.infer<typeof monitoringDataSchema>;
export type StockUser = z.infer<typeof userSchema>;
export type StockOrganisation = z.infer<typeof organisationSchema>;
