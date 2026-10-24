/**
 * ERP-4 Finance & Accounting — Migration Mapping Routes (KIT-05 / ERP4-28)
 *
 * Exposes endpoints for:
 * - Listing and retrieving named, versioned mapping templates (AC4)
 * - Validating field mapping configurations against target entity schemas (AC3)
 * - Transforming cleaned/raw source records into validated domain target shapes (AC1, AC2)
 *
 * Endpoints:
 * - GET  /migration/mapping/templates        - List available named mapping templates
 * - GET  /migration/mapping/templates/:id    - Get detailed named mapping template
 * - POST /migration/mapping/validate         - Validate field mapping & check required targets
 * - POST /migration/mapping/transform        - Project & coerce dataset using mapping config
 *
 * @module erp4/routes/mapping
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireFinancePolicy, FinancePolicies } from '../policies/index.js';
import {
  ERP4_DEFAULT_MAPPING_TEMPLATES,
  ERP4_CANONICAL_MAPPING_TEMPLATE,
  erp4TargetEntities,
  validateErp4Mapping,
  transformDataset,
} from '../migration/mapping-config.js';

const ValidateMappingBodySchema = z.object({
  entity: z.string().min(1, 'Entity name is required'),
  mapping: z.record(z.string(), z.string()),
  sourceTypes: z.record(z.string(), z.string()).optional(),
});

const TransformMappingBodySchema = z.object({
  entity: z.string().min(1, 'Entity name is required'),
  mapping: z.record(z.string(), z.string()),
  rows: z.array(z.record(z.string(), z.unknown())).min(1, 'rows must contain at least one item'),
});

export const mappingRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /migration/mapping/templates - List named mapping templates
  fastify.get(
    '/migration/mapping/templates',
    { preHandler: [requireFinancePolicy(FinancePolicies.MIGRATION_MAPPING_READ)] },
    async (_request, reply) => {
      return reply.status(200).send({
        success: true,
        data: ERP4_DEFAULT_MAPPING_TEMPLATES.map((t) => ({
          templateId: t.templateId,
          name: t.name,
          version: t.version,
          module: t.module,
          description: t.description,
          mappingSchemaVersion: t.mappingSchemaVersion,
          entities: Object.keys(t.entities),
          createdAt: t.createdAt,
        })),
      });
    }
  );

  // GET /migration/mapping/templates/:id - Get specific versioned template
  fastify.get<{ Params: { id: string } }>(
    '/migration/mapping/templates/:id',
    { preHandler: [requireFinancePolicy(FinancePolicies.MIGRATION_MAPPING_READ)] },
    async (request, reply) => {
      const templateId = request.params.id;
      const found = ERP4_DEFAULT_MAPPING_TEMPLATES.find(
        (t) => t.templateId === templateId || t.name === templateId
      );

      if (!found) {
        return reply.status(404).send({
          code: 'TEMPLATE_NOT_FOUND',
          message: `Mapping template '${templateId}' not found.`,
          details: { requestedId: templateId },
        });
      }

      return reply.status(200).send({
        success: true,
        data: found,
      });
    }
  );

  // GET /migration/mapping/schema - Get ERP-4 target entity schemas & fields
  fastify.get(
    '/migration/mapping/schema',
    { preHandler: [requireFinancePolicy(FinancePolicies.MIGRATION_MAPPING_READ)] },
    async (_request, reply) => {
      return reply.status(200).send({
        success: true,
        data: erp4TargetEntities,
      });
    }
  );

  // POST /migration/mapping/validate - Validate mapping config & check required fields
  fastify.post(
    '/migration/mapping/validate',
    { preHandler: [requireFinancePolicy(FinancePolicies.MIGRATION_MAPPING_RUN)] },
    async (request, reply) => {
      const parseResult = ValidateMappingBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'BAD_REQUEST',
          message: 'Invalid mapping validation request body',
          details: parseResult.error.flatten(),
        });
      }

      const { entity, mapping, sourceTypes } = parseResult.data;
      if (!erp4TargetEntities[entity]) {
        return reply.status(404).send({
          code: 'ENTITY_NOT_FOUND',
          message: `Target entity '${entity}' is not recognized in module erp4.`,
          details: { validEntities: Object.keys(erp4TargetEntities) },
        });
      }

      const validation = validateErp4Mapping(entity, mapping, sourceTypes);

      return reply.status(200).send({
        success: true,
        data: validation,
      });
    }
  );

  // POST /migration/mapping/transform - Apply mapping, enum translation, & coercion to rows
  fastify.post(
    '/migration/mapping/transform',
    { preHandler: [requireFinancePolicy(FinancePolicies.MIGRATION_MAPPING_RUN)] },
    async (request, reply) => {
      const parseResult = TransformMappingBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'BAD_REQUEST',
          message: 'Invalid mapping transform request body',
          details: parseResult.error.flatten(),
        });
      }

      const { entity, mapping, rows } = parseResult.data;
      if (!erp4TargetEntities[entity]) {
        return reply.status(404).send({
          code: 'ENTITY_NOT_FOUND',
          message: `Target entity '${entity}' is not recognized in module erp4.`,
          details: { validEntities: Object.keys(erp4TargetEntities) },
        });
      }

      // Check validation first
      const validation = validateErp4Mapping(entity, mapping);
      if (!validation.valid) {
        return reply.status(400).send({
          code: 'UNMAPPED_REQUIRED_FIELDS',
          message: `Mapping is invalid: missing required target field(s) [${validation.missingRequiredFields.join(', ')}].`,
          details: validation,
        });
      }

      const result = transformDataset(entity, mapping, rows);

      return reply.status(200).send({
        success: true,
        data: result,
      });
    }
  );
};
